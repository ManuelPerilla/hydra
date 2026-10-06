use anyhow::Result;
use axum::{Router, extract::State, http::StatusCode, routing::get};
use hydra_chaos_agent::{
    api::{HydraApi, Report, Reporter, Target},
    config::Config,
    experiment::{self, Settings},
    kubernetes::{Cluster, Kubernetes},
    policy,
};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::sleep;

#[derive(Default)]
struct Health {
    last_sync: AtomicU64,
    jobs: AtomicU64,
    recovered: AtomicU64,
    failures: AtomicU64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let config = Arc::new(Config::from_env()?);
    let cluster = Arc::new(Kubernetes::new(&config.namespace).await?);
    let api = Arc::new(HydraApi::new(config.api_url.clone(), config.token.clone())?);
    let health = Arc::new(Health::default());
    tokio::spawn(inventory(
        cluster.clone(),
        api.clone(),
        health.clone(),
        config.poll_interval,
    ));
    tokio::spawn(worker(cluster, api, health.clone(), config));
    let app = Router::new()
        .route("/health/live", get(|| async { StatusCode::OK }))
        .route("/health/ready", get(ready))
        .route("/metrics", get(metrics))
        .with_state(health);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await?;
    tracing::info!("Hydra agent started; namespace restricted to chaos-demo");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn ready(State(health): State<Arc<Health>>) -> StatusCode {
    let last = health.last_sync.load(Ordering::Acquire);
    if last > 0 && now().saturating_sub(last) < 20 {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
async fn metrics(
    State(health): State<Arc<Health>>,
) -> ([(axum::http::HeaderName, &'static str); 1], String) {
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        format!(
            "# TYPE hydra_agent_jobs_total counter\nhydra_agent_jobs_total {}\n# TYPE hydra_agent_recovered_total counter\nhydra_agent_recovered_total {}\n# TYPE hydra_agent_failures_total counter\nhydra_agent_failures_total {}\n",
            health.jobs.load(Ordering::Relaxed),
            health.recovered.load(Ordering::Relaxed),
            health.failures.load(Ordering::Relaxed)
        ),
    )
}

async fn inventory(
    cluster: Arc<Kubernetes>,
    api: Arc<HydraApi>,
    health: Arc<Health>,
    interval: Duration,
) {
    loop {
        match inventory_once(&*cluster, &api).await {
            Ok(()) => {
                health.last_sync.store(now(), Ordering::Release);
            }
            Err(_) => tracing::warn!("Inventory synchronization failed; readiness will expire"),
        }
        sleep(interval).await;
    }
}

async fn inventory_once(cluster: &dyn Cluster, api: &HydraApi) -> Result<()> {
    let pods = cluster.pods().await?;
    let mut owners = HashMap::new();
    let mut targets = Vec::new();
    for pod in pods.iter().filter(|pod| policy::eligible(pod)) {
        let owner = policy::controller(pod).expect("eligible checked controller");
        if !owners.contains_key(&owner.name) {
            owners.insert(owner.name.clone(), cluster.replica_set(&owner.name).await?);
        }
        let target = Target {
            namespace: "chaos-demo".into(),
            name: pod.metadata.name.clone().unwrap_or_default(),
            uid: pod.metadata.uid.clone().unwrap_or_default(),
            ready: policy::ready(pod),
        };
        if policy::validate_target(&target, pod, &owners[&owner.name]).is_ok() {
            targets.push(target);
        }
    }
    api.heartbeat(&targets).await
}

async fn worker(
    cluster: Arc<Kubernetes>,
    api: Arc<HydraApi>,
    health: Arc<Health>,
    config: Arc<Config>,
) {
    let settings = Settings {
        minimum_ready: config.minimum_ready,
        poll: config.poll_interval,
        recovery_timeout: config.recovery_timeout,
        budget_timeout: Duration::from_secs(20),
    };
    let mut backoff = 2;
    loop {
        let job = match api.claim(&config.agent_id).await {
            Ok(Some(job)) => {
                backoff = 2;
                job
            }
            Ok(None) => {
                backoff = 2;
                sleep(config.poll_interval).await;
                continue;
            }
            Err(_) => {
                tracing::warn!("Job claim failed; retrying with bounded backoff");
                sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(30);
                continue;
            }
        };
        health.jobs.fetch_add(1, Ordering::Relaxed);
        let running = Report::new(
            &job,
            "running",
            "Agent accepted the fixed-UID experiment lease",
        );
        if api.report(&job, &running).await.is_err() {
            tracing::warn!("Job start rejected; no Kubernetes mutation issued");
            continue;
        }
        let lease_alive = Arc::new(AtomicBool::new(true));
        let renewal = {
            let api = api.clone();
            let job = job.clone();
            let lease_alive = lease_alive.clone();
            tokio::spawn(async move {
                loop {
                    sleep(Duration::from_secs(10)).await;
                    if api.report(&job, &running).await.is_err() {
                        lease_alive.store(false, Ordering::Release);
                        tracing::warn!("Job lease renewal failed; further deletion is forbidden");
                        break;
                    }
                }
            })
        };
        let result = experiment::execute(&*cluster, &*api, &job, &settings, &lease_alive).await;
        renewal.abort();
        let _ = renewal.await;
        match result {
            Ok(outcome) => {
                health.recovered.fetch_add(1, Ordering::Relaxed);
                tracing::info!(
                    recovery_ms = outcome.recovery_ms,
                    dry_run = job.dry_run,
                    "Experiment completed"
                );
                if outcome.publish
                    && let Some(credentials) = &config.x
                    && credentials.publish(&outcome.tweet_draft).await.is_err()
                {
                    tracing::warn!(
                        "Optional X publication failed; the tweet draft is saved in the experiment audit"
                    );
                }
            }
            Err(error) => {
                health.failures.fetch_add(1, Ordering::Relaxed);
                // Only policy and cluster errors are placed in the private audit.
                // No request bodies, credentials, or X responses are logged.
                let message = format!("Experiment stopped safely: {error}");
                let report = Report::new(&job, "failed", message);
                if api.report(&job, &report).await.is_err() {
                    tracing::warn!("Final experiment report could not be delivered");
                }
                tracing::warn!("Experiment failed; no alternative victim will be selected");
            }
        }
        sleep(config.poll_interval).await;
    }
}

async fn shutdown() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
        } else {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
