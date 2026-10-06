use anyhow::{Context, Result, bail, ensure};
use std::{env, time::Duration};

pub const ALLOWED_NAMESPACE: &str = "chaos-demo";

// Deliberately has no Debug implementation: tokens must never reach diagnostics.
pub struct Config {
    pub api_url: reqwest::Url,
    pub token: String,
    pub agent_id: String,
    pub namespace: String,
    pub minimum_ready: usize,
    pub poll_interval: Duration,
    pub recovery_timeout: Duration,
    pub x: Option<crate::x::Credentials>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let namespace = env::var("HYDRA_NAMESPACE").unwrap_or_else(|_| ALLOWED_NAMESPACE.into());
        validate_namespace(&namespace)?;
        let token = env::var("HYDRA_AGENT_TOKEN").context("HYDRA_AGENT_TOKEN is required")?;
        ensure!(
            token.len() >= 32,
            "HYDRA_AGENT_TOKEN must contain at least 32 bytes"
        );
        let api_url = reqwest::Url::parse(
            &env::var("HYDRA_API_URL").unwrap_or_else(|_| "http://api:8080".into()),
        )
        .context("HYDRA_API_URL must be an absolute HTTP(S) URL")?;
        ensure!(
            matches!(api_url.scheme(), "http" | "https") && api_url.host_str().is_some(),
            "HYDRA_API_URL requires HTTP(S)"
        );
        ensure!(
            api_url.username().is_empty()
                && api_url.password().is_none()
                && api_url.query().is_none()
                && api_url.fragment().is_none(),
            "HYDRA_API_URL must not contain credentials, query, or fragment"
        );
        let agent_id = env::var("HYDRA_AGENT_ID").unwrap_or_else(|_| "hydra-agent".into());
        ensure!(
            !agent_id.is_empty() && agent_id.len() <= 128,
            "invalid HYDRA_AGENT_ID"
        );
        let minimum_ready = number("HYDRA_MIN_READY", 2)?;
        ensure!(
            (2..=10).contains(&minimum_ready),
            "HYDRA_MIN_READY must be between 2 and 10"
        );
        let recovery_seconds = number("HYDRA_RECOVERY_TIMEOUT_SECONDS", 120)?;
        ensure!(
            (10..=150).contains(&recovery_seconds),
            "recovery timeout must be between 10 and 150 seconds"
        );
        let x = match env::var("HYDRA_X_ENABLED").as_deref().unwrap_or("false") {
            "false" => None,
            "true" => Some(crate::x::Credentials::from_env()?),
            _ => bail!("HYDRA_X_ENABLED must be true or false"),
        };
        Ok(Self {
            api_url,
            token,
            agent_id,
            namespace,
            minimum_ready,
            poll_interval: Duration::from_secs(2),
            recovery_timeout: Duration::from_secs(recovery_seconds as u64),
            x,
        })
    }
}

pub fn validate_namespace(namespace: &str) -> Result<()> {
    ensure!(
        namespace == ALLOWED_NAMESPACE,
        "agent is restricted to namespace chaos-demo"
    );
    Ok(())
}

fn number(name: &str, default: usize) -> Result<usize> {
    match env::var(name) {
        Ok(value) => value
            .parse()
            .with_context(|| format!("{name} must be an integer")),
        Err(_) => Ok(default),
    }
}
