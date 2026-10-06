use anyhow::{Context, Result, ensure};
use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub namespace: String,
    pub name: String,
    pub uid: String,
    #[serde(default)]
    pub ready: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub lease_token: String,
    pub target: Target,
    pub dry_run: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub lease_token: String,
    pub status: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tweet_draft: Option<String>,
}

impl Report {
    pub fn new(job: &Job, status: &'static str, message: impl Into<String>) -> Self {
        Self {
            lease_token: job.lease_token.clone(),
            status,
            message: message.into(),
            recovery_ms: None,
            tweet_draft: None,
        }
    }
}

#[async_trait]
pub trait Reporter: Send + Sync {
    async fn report(&self, job: &Job, report: &Report) -> Result<()>;
    async fn recovered_with_inventory(
        &self,
        job: &Job,
        report: &Report,
        _targets: &[Target],
    ) -> Result<()> {
        self.report(job, report).await
    }
}

// Clone retains the connection pool. No Debug implementation exposes the token.
#[derive(Clone)]
pub struct HydraApi {
    client: Client,
    base: Url,
    token: String,
    inventory_writes: Arc<Mutex<()>>,
}

impl HydraApi {
    pub fn new(base: Url, token: String) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            client,
            base,
            token,
            inventory_writes: Arc::new(Mutex::new(())),
        })
    }

    fn endpoint(&self, segments: &[&str]) -> Result<Url> {
        let mut url = self.base.clone();
        url.set_path("");
        url.path_segments_mut()
            .map_err(|_| anyhow::anyhow!("API URL cannot be a base"))?
            .extend(segments);
        Ok(url)
    }

    pub async fn heartbeat(&self, targets: &[Target]) -> Result<()> {
        let _guard = self.inventory_writes.lock().await;
        self.heartbeat_unlocked(targets).await
    }

    async fn heartbeat_unlocked(&self, targets: &[Target]) -> Result<()> {
        let ready = targets.iter().filter(|target| target.ready).count();
        self.client
            .post(self.endpoint(&["internal", "agent", "heartbeat"])?)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({"targets":targets,"ready":ready,"total":targets.len()}))
            .send()
            .await
            .context("heartbeat transport failed")?
            .error_for_status()
            .context("heartbeat rejected")?;
        Ok(())
    }

    pub async fn claim(&self, agent_id: &str) -> Result<Option<Job>> {
        let response = self
            .client
            .post(self.endpoint(&["internal", "jobs", "claim"])?)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({"agentId":agent_id}))
            .send()
            .await
            .context("job claim transport failed")?;
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        let job: Job = response
            .error_for_status()
            .context("job claim rejected")?
            .json()
            .await
            .context("invalid job payload")?;
        ensure!(
            !job.id.is_empty() && job.id.len() <= 128 && !job.lease_token.is_empty(),
            "invalid claimed job identity"
        );
        Ok(Some(job))
    }
}

#[async_trait]
impl Reporter for HydraApi {
    async fn recovered_with_inventory(
        &self,
        job: &Job,
        report: &Report,
        targets: &[Target],
    ) -> Result<()> {
        // Hold the writer gate through both calls. A periodic heartbeat fetched
        // before deletion cannot overwrite this observation before certification.
        let _guard = self.inventory_writes.lock().await;
        self.heartbeat_unlocked(targets).await?;
        self.report(job, report).await
    }
    async fn report(&self, job: &Job, report: &Report) -> Result<()> {
        // The same event payload is replayed on transient failures. The API deduplicates
        // by experiment and status; a retry never becomes another Kubernetes mutation.
        let mut last_error = None;
        for attempt in 0..3 {
            let response = self
                .client
                .post(self.endpoint(&["internal", "jobs", &job.id, "report"])?)
                .bearer_auth(&self.token)
                .json(report)
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => return Ok(()),
                Ok(response) if response.status().is_client_error() => {
                    anyhow::bail!("job report rejected ({})", response.status().as_u16())
                }
                Ok(response) => {
                    last_error = Some(anyhow::anyhow!(
                        "job report server failure ({})",
                        response.status().as_u16()
                    ))
                }
                Err(_) => last_error = Some(anyhow::anyhow!("job report transport failed")),
            }
            if attempt < 2 {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("job report failed")))
    }
}
