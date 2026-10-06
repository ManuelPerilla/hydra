use crate::{api::Target, config::validate_namespace};
use anyhow::{Result, ensure};
use k8s_openapi::{
    api::{apps::v1::ReplicaSet, core::v1::Pod},
    apimachinery::pkg::apis::meta::v1::OwnerReference,
};

pub const ENABLED_SELECTOR: &str = "hydra.io/chaos=enabled";

pub fn controller(pod: &Pod) -> Option<&OwnerReference> {
    pod.metadata
        .owner_references
        .as_ref()?
        .iter()
        .find(|owner| {
            owner.controller == Some(true)
                && owner.kind == "ReplicaSet"
                && owner.api_version == "apps/v1"
        })
}

pub fn eligible(pod: &Pod) -> bool {
    pod.metadata.namespace.as_deref() == Some("chaos-demo")
        && pod
            .metadata
            .labels
            .as_ref()
            .and_then(|labels| labels.get("hydra.io/chaos"))
            .map(String::as_str)
            == Some("enabled")
        && pod.metadata.deletion_timestamp.is_none()
        && pod.metadata.uid.as_ref().is_some_and(|uid| !uid.is_empty())
        && controller(pod).is_some()
}

pub fn ready(pod: &Pod) -> bool {
    eligible(pod)
        && pod.status.as_ref().is_some_and(|status| {
            status.phase.as_deref() == Some("Running")
                && status.conditions.as_ref().is_some_and(|conditions| {
                    conditions
                        .iter()
                        .any(|condition| condition.type_ == "Ready" && condition.status == "True")
                })
        })
}

pub fn validate_target(target: &Target, pod: &Pod, replica_set: &ReplicaSet) -> Result<String> {
    validate_namespace(&target.namespace)?;
    ensure!(
        !target.uid.is_empty() && !target.name.is_empty(),
        "target must have a name and an immutable UID"
    );
    ensure!(eligible(pod), "pod is not explicitly eligible for chaos");
    ensure!(
        pod.metadata.name.as_deref() == Some(target.name.as_str())
            && pod.metadata.uid.as_deref() == Some(target.uid.as_str()),
        "target UID changed; refusing to delete a replacement"
    );
    let owner = controller(pod).expect("eligible checked controller");
    ensure!(
        replica_set.metadata.namespace.as_deref() == Some(target.namespace.as_str())
            && replica_set.metadata.name.as_deref() == Some(owner.name.as_str())
            && replica_set.metadata.uid.as_deref() == Some(owner.uid.as_str()),
        "ReplicaSet identity changed"
    );
    let deployment_owner = replica_set
        .metadata
        .owner_references
        .as_ref()
        .and_then(|owners| {
            owners.iter().find(|reference| {
                reference.controller == Some(true)
                    && reference.kind == "Deployment"
                    && reference.api_version == "apps/v1"
            })
        });
    ensure!(
        deployment_owner.is_some(),
        "pod must belong to a Deployment-controlled ReplicaSet"
    );
    Ok(owner.uid.clone())
}

pub fn ready_count(pods: &[Pod], replica_set_uid: &str, excluded_uid: Option<&str>) -> usize {
    pods.iter()
        .filter(|pod| {
            ready(pod)
                && controller(pod).is_some_and(|owner| owner.uid == replica_set_uid)
                && excluded_uid != pod.metadata.uid.as_deref()
        })
        .count()
}

pub fn original_present(pods: &[Pod], uid: &str) -> bool {
    // UID, not the mutable name, is the deletion acknowledgement.
    pods.iter()
        .any(|pod| pod.metadata.uid.as_deref() == Some(uid))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn pod(name: &str, uid: &str, owner: &str, is_ready: bool) -> Pod {
        serde_json::from_value(json!({"metadata":{"name":name,"namespace":"chaos-demo","uid":uid,"labels":{"hydra.io/chaos":"enabled"},"ownerReferences":[{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"demo-rs","uid":owner,"controller":true}]},"status":{"phase":"Running","conditions":[{"type":"Ready","status":if is_ready {"True"} else {"False"}}]}})).unwrap()
    }

    pub(crate) fn replica_set() -> ReplicaSet {
        serde_json::from_value(json!({"metadata":{"name":"demo-rs","namespace":"chaos-demo","uid":"rs-uid","ownerReferences":[{"apiVersion":"apps/v1","kind":"Deployment","name":"demo","uid":"deployment-uid","controller":true}]}})).unwrap()
    }

    #[test]
    fn replacement_with_same_name_is_never_deleted() {
        let target = Target {
            namespace: "chaos-demo".into(),
            name: "demo-a".into(),
            uid: "old".into(),
            ready: false,
        };
        assert!(
            validate_target(
                &target,
                &pod("demo-a", "new", "rs-uid", true),
                &replica_set()
            )
            .is_err()
        );
    }

    #[test]
    fn denies_every_namespace_except_explicit_lab() {
        for namespace in [
            "default",
            "hydra-system",
            "kube-system",
            "chaos-demo-other",
            "",
        ] {
            assert!(validate_namespace(namespace).is_err());
        }
    }

    #[test]
    fn naked_replica_set_and_unlabelled_pod_are_denied() {
        let mut rs = replica_set();
        rs.metadata.owner_references = None;
        let target = Target {
            namespace: "chaos-demo".into(),
            name: "demo-a".into(),
            uid: "old".into(),
            ready: false,
        };
        let mut value = pod("demo-a", "old", "rs-uid", true);
        assert!(validate_target(&target, &value, &rs).is_err());
        value.metadata.labels = None;
        assert!(!eligible(&value));
    }

    #[test]
    fn recovery_counts_only_ready_replacements_of_same_controller() {
        let pods = vec![
            pod("demo-a", "old", "rs-uid", true),
            pod("demo-a", "new", "rs-uid", true),
            pod("other", "other", "other-rs", true),
            pod("starting", "pending", "rs-uid", false),
        ];
        assert_eq!(ready_count(&pods, "rs-uid", Some("old")), 1);
        assert!(original_present(&pods, "old"));
        assert!(!original_present(&pods[1..], "old"));
    }
}
