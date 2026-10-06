use crate::{
    api::{Job, Report, Reporter},
    config::validate_namespace,
    kubernetes::{Cluster, DeleteOutcome},
    policy,
};
use anyhow::{Result, bail, ensure};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::time::{Instant, sleep};

pub struct Settings {
    pub minimum_ready: usize,
    pub poll: Duration,
    pub recovery_timeout: Duration,
    pub budget_timeout: Duration,
}

pub struct Outcome {
    pub recovery_ms: u64,
    pub tweet_draft: String,
    pub publish: bool,
}

pub async fn execute(
    cluster: &dyn Cluster,
    reporter: &dyn Reporter,
    job: &Job,
    settings: &Settings,
    lease_alive: &AtomicBool,
) -> Result<Outcome> {
    validate_namespace(&job.target.namespace)?;
    ensure!(
        settings.minimum_ready >= 2,
        "ready budget cannot be below two replicas"
    );
    ensure!(!job.target.uid.is_empty(), "job lacks immutable pod UID");
    let Some(initial) = cluster.pod(&job.target.name).await? else {
        ensure!(
            !job.dry_run,
            "dry-run target no longer exists; no mutation issued"
        );
        reporter
            .report(
                job,
                &Report::new(
                    job,
                    "deleted",
                    "Original pod is already absent; no deletion was issued",
                ),
            )
            .await?;
        bail!(
            "original pod already absent; recovery cannot be attributed without a verified controller"
        );
    };
    let owner = policy::controller(&initial)
        .ok_or_else(|| anyhow::anyhow!("target is not ReplicaSet-controlled"))?;
    let replica_set = cluster.replica_set(&owner.name).await?;
    let owner_uid = policy::validate_target(&job.target, &initial, &replica_set)?;
    let budget_deadline = Instant::now() + settings.budget_timeout;
    let baseline;
    loop {
        ensure!(
            lease_alive.load(Ordering::Acquire),
            "job lease could not be renewed; no deletion issued"
        );
        let pods = cluster.pods().await?;
        let ready = policy::ready_count(&pods, &owner_uid, None);
        if !policy::original_present(&pods, &job.target.uid) {
            let current = cluster.pod(&job.target.name).await?;
            if current
                .as_ref()
                .is_some_and(|pod| pod.metadata.uid.as_deref() == Some(job.target.uid.as_str()))
            {
                bail!(
                    "target disappeared from eligible inventory but still exists; no deletion issued"
                );
            }
            ensure!(
                !job.dry_run,
                "dry-run target disappeared during validation; no mutation issued"
            );
            return observe_recovery(
                cluster,
                reporter,
                job,
                settings,
                &owner_uid,
                settings.minimum_ready,
                false,
                Instant::now(),
            )
            .await;
        }
        if ready >= settings.minimum_ready
            && pods.iter().any(|pod| {
                pod.metadata.uid.as_deref() == Some(job.target.uid.as_str()) && policy::ready(pod)
            })
        {
            baseline = ready;
            break;
        }
        ensure!(
            Instant::now() < budget_deadline,
            "ready replica budget was not met; no deletion issued"
        );
        sleep(settings.poll).await;
    }
    // Recheck identity and its controlling ReplicaSet immediately before mutation.
    // The API-server UID precondition closes the race after this read.
    let Some(current) = cluster.pod(&job.target.name).await? else {
        ensure!(
            !job.dry_run,
            "dry-run target disappeared before validation completed; no mutation issued"
        );
        return observe_recovery(
            cluster,
            reporter,
            job,
            settings,
            &owner_uid,
            baseline,
            false,
            Instant::now(),
        )
        .await;
    };
    let current_replica_set = cluster.replica_set(&owner.name).await?;
    policy::validate_target(&job.target, &current, &current_replica_set)?;
    ensure!(
        policy::ready(&current),
        "target became unready; no deletion issued"
    );
    ensure!(
        lease_alive.load(Ordering::Acquire),
        "job lease expired before deletion"
    );
    if job.dry_run {
        let draft = format!(
            "[DRY RUN] Hydra would delete pod {} in {}; no server was destroyed. #ChaosEngineering",
            job.target.name, job.target.namespace
        );
        let mut report = Report::new(
            job,
            "recovered",
            "Dry-run validated namespace, ownership, UID, and ready budget; no Kubernetes mutation",
        );
        report.recovery_ms = Some(0);
        report.tweet_draft = Some(draft.clone());
        reporter.report(job, &report).await?;
        return Ok(Outcome {
            recovery_ms: 0,
            tweet_draft: draft,
            publish: false,
        });
    }
    let started = Instant::now();
    let result = cluster
        .delete_uid(&job.target.name, &job.target.uid)
        .await?;
    observe_recovery(
        cluster,
        reporter,
        job,
        settings,
        &owner_uid,
        baseline,
        result == DeleteOutcome::Accepted,
        started,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn observe_recovery(
    cluster: &dyn Cluster,
    reporter: &dyn Reporter,
    job: &Job,
    settings: &Settings,
    owner_uid: &str,
    baseline: usize,
    issued_deletion: bool,
    started: Instant,
) -> Result<Outcome> {
    let deadline = started + settings.recovery_timeout;
    let draft = format!(
        "Una cabeza menos: pod {} cayó en {}. Kubernetes está reconstruyendo Hydra. #ChaosEngineering #Kubernetes",
        job.target.name, job.target.namespace
    );
    let mut disappearance_confirmed = false;
    loop {
        let pods = cluster.pods().await?;
        let current = cluster.pod(&job.target.name).await?;
        let original_still_exists = current
            .as_ref()
            .is_some_and(|pod| pod.metadata.uid.as_deref() == Some(job.target.uid.as_str()));
        if !original_still_exists && !disappearance_confirmed {
            let mut report = Report::new(
                job,
                "deleted",
                "API-server observation confirmed original UID is absent",
            );
            report.tweet_draft = Some(draft.clone());
            reporter.report(job, &report).await?;
            disappearance_confirmed = true;
        }
        let ready = policy::ready_count(&pods, owner_uid, Some(&job.target.uid));
        let controller_pods: Vec<_> = pods
            .iter()
            .filter(|pod| {
                policy::eligible(pod)
                    && policy::controller(pod).is_some_and(|owner| owner.uid == owner_uid)
            })
            .collect();
        if disappearance_confirmed && ready >= baseline && ready == controller_pods.len() {
            // Refresh the server's inventory before asking it to certify recovery.
            // Otherwise the periodic heartbeat could still contain the old UID.
            let targets = controller_pods
                .into_iter()
                .map(|pod| crate::api::Target {
                    namespace: job.target.namespace.clone(),
                    name: pod.metadata.name.clone().unwrap_or_default(),
                    uid: pod.metadata.uid.clone().unwrap_or_default(),
                    ready: policy::ready(pod),
                })
                .collect::<Vec<_>>();
            let recovery_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
            let mut report = Report::new(
                job,
                "recovered",
                format!(
                    "Original UID absent; {ready} ready replicas of the verified ReplicaSet restored (baseline {baseline})"
                ),
            );
            report.recovery_ms = Some(recovery_ms);
            report.tweet_draft = Some(draft.clone());
            reporter
                .recovered_with_inventory(job, &report, &targets)
                .await?;
            return Ok(Outcome {
                recovery_ms,
                tweet_draft: draft,
                publish: issued_deletion,
            });
        }
        if Instant::now() >= deadline {
            bail!(
                "recovery deadline exceeded: disappearance confirmed={disappearance_confirmed}, ready replicas={ready}, required={baseline}"
            );
        }
        sleep(settings.poll).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        api::Target,
        policy::tests::{pod, replica_set},
    };
    use async_trait::async_trait;
    use k8s_openapi::api::{apps::v1::ReplicaSet, core::v1::Pod};
    use std::sync::{Mutex, atomic::AtomicUsize};

    struct FakeCluster {
        pods: Mutex<Vec<Pod>>,
        deletes: AtomicUsize,
        replace_same_name: bool,
        strip_label_instead_of_delete: bool,
        replacement_owner: &'static str,
    }
    #[async_trait]
    impl Cluster for FakeCluster {
        async fn pods(&self) -> Result<Vec<Pod>> {
            Ok(self
                .pods
                .lock()
                .unwrap()
                .iter()
                .filter(|pod| {
                    pod.metadata.labels.as_ref().is_some_and(|labels| {
                        labels.get("hydra.io/chaos").map(String::as_str) == Some("enabled")
                    })
                })
                .cloned()
                .collect())
        }
        async fn pod(&self, name: &str) -> Result<Option<Pod>> {
            Ok(self
                .pods
                .lock()
                .unwrap()
                .iter()
                .find(|pod| pod.metadata.name.as_deref() == Some(name))
                .cloned())
        }
        async fn replica_set(&self, _: &str) -> Result<ReplicaSet> {
            Ok(replica_set())
        }
        async fn delete_uid(&self, name: &str, uid: &str) -> Result<DeleteOutcome> {
            self.deletes.fetch_add(1, Ordering::SeqCst);
            let mut pods = self.pods.lock().unwrap();
            let original = pods
                .iter()
                .position(|pod| {
                    pod.metadata.name.as_deref() == Some(name)
                        && pod.metadata.uid.as_deref() == Some(uid)
                })
                .ok_or_else(|| anyhow::anyhow!("UID precondition failed"))?;
            if self.strip_label_instead_of_delete {
                pods[original].metadata.labels = None;
                return Ok(DeleteOutcome::Accepted);
            }
            pods.remove(original);
            pods.push(pod(
                if self.replace_same_name {
                    name
                } else {
                    "demo-new"
                },
                "replacement-uid",
                self.replacement_owner,
                true,
            ));
            Ok(DeleteOutcome::Accepted)
        }
    }
    #[derive(Default)]
    struct Events(Mutex<Vec<String>>);
    #[async_trait]
    impl Reporter for Events {
        async fn report(&self, _: &Job, report: &Report) -> Result<()> {
            self.0.lock().unwrap().push(report.status.into());
            Ok(())
        }
    }
    fn settings() -> Settings {
        Settings {
            minimum_ready: 2,
            poll: Duration::from_millis(1),
            recovery_timeout: Duration::from_millis(10),
            budget_timeout: Duration::from_millis(3),
        }
    }
    fn job(dry_run: bool) -> Job {
        Job {
            id: "job-1".into(),
            lease_token: "lease".into(),
            target: Target {
                namespace: "chaos-demo".into(),
                name: "demo-a".into(),
                uid: "victim".into(),
                ready: true,
            },
            dry_run,
        }
    }
    fn cluster() -> FakeCluster {
        FakeCluster {
            pods: Mutex::new(vec![
                pod("demo-a", "victim", "rs-uid", true),
                pod("demo-b", "survivor", "rs-uid", true),
            ]),
            deletes: AtomicUsize::new(0),
            replace_same_name: true,
            strip_label_instead_of_delete: false,
            replacement_owner: "rs-uid",
        }
    }

    #[tokio::test]
    async fn dry_run_never_calls_delete() {
        let cluster = cluster();
        let events = Events::default();
        let result = execute(
            &cluster,
            &events,
            &job(true),
            &settings(),
            &AtomicBool::new(true),
        )
        .await
        .unwrap();
        assert!(!result.publish);
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 0);
        assert_eq!(*events.0.lock().unwrap(), vec!["recovered"]);
    }
    #[tokio::test]
    async fn confirms_old_uid_absence_and_recovers_even_with_reused_name() {
        let cluster = cluster();
        let events = Events::default();
        let result = execute(
            &cluster,
            &events,
            &job(false),
            &settings(),
            &AtomicBool::new(true),
        )
        .await
        .unwrap();
        assert!(result.publish);
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 1);
        assert_eq!(*events.0.lock().unwrap(), vec!["deleted", "recovered"]);
    }
    #[tokio::test]
    async fn does_not_delete_when_ready_budget_or_lease_is_missing() {
        let cluster = cluster();
        cluster.pods.lock().unwrap().remove(1);
        assert!(
            execute(
                &cluster,
                &Events::default(),
                &job(false),
                &settings(),
                &AtomicBool::new(true)
            )
            .await
            .is_err()
        );
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 0);
        let cluster = self::cluster();
        assert!(
            execute(
                &cluster,
                &Events::default(),
                &job(false),
                &settings(),
                &AtomicBool::new(false)
            )
            .await
            .is_err()
        );
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 0);
    }
    #[tokio::test]
    async fn replay_never_chooses_another_victim() {
        let cluster = cluster();
        let events = Events::default();
        execute(
            &cluster,
            &events,
            &job(false),
            &settings(),
            &AtomicBool::new(true),
        )
        .await
        .unwrap();
        assert!(
            execute(
                &cluster,
                &events,
                &job(false),
                &settings(),
                &AtomicBool::new(true)
            )
            .await
            .is_err()
        );
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn losing_label_is_not_confirmation_of_original_uid_deletion() {
        let mut cluster = cluster();
        cluster.strip_label_instead_of_delete = true;
        let events = Events::default();
        assert!(
            execute(
                &cluster,
                &events,
                &job(false),
                &settings(),
                &AtomicBool::new(true)
            )
            .await
            .is_err()
        );
        assert!(events.0.lock().unwrap().is_empty());
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn unrelated_ready_replicas_do_not_certify_recovery() {
        let mut cluster = cluster();
        cluster.replacement_owner = "unrelated-replica-set";
        let events = Events::default();
        assert!(
            execute(
                &cluster,
                &events,
                &job(false),
                &settings(),
                &AtomicBool::new(true)
            )
            .await
            .is_err()
        );
        assert_eq!(*events.0.lock().unwrap(), vec!["deleted"]);
        assert_eq!(cluster.deletes.load(Ordering::SeqCst), 1);
    }
}
