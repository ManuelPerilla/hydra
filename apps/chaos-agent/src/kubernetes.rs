use crate::{config::validate_namespace, policy::ENABLED_SELECTOR};
use anyhow::{Result, ensure};
use async_trait::async_trait;
use k8s_openapi::api::{apps::v1::ReplicaSet, core::v1::Pod};
use kube::{
    Api, Client,
    api::{DeleteParams, ListParams, Preconditions},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DeleteOutcome {
    Accepted,
    AlreadyGone,
}

#[async_trait]
pub trait Cluster: Send + Sync {
    async fn pods(&self) -> Result<Vec<Pod>>;
    async fn pod(&self, name: &str) -> Result<Option<Pod>>;
    async fn replica_set(&self, name: &str) -> Result<ReplicaSet>;
    async fn delete_uid(&self, name: &str, uid: &str) -> Result<DeleteOutcome>;
}

pub struct Kubernetes {
    pods: Api<Pod>,
    replica_sets: Api<ReplicaSet>,
}

impl Kubernetes {
    pub async fn new(namespace: &str) -> Result<Self> {
        validate_namespace(namespace)?;
        let mut config = kube::Config::infer().await?;
        config.connect_timeout = Some(std::time::Duration::from_secs(3));
        config.read_timeout = Some(std::time::Duration::from_secs(10));
        let client = Client::try_from(config)?;
        Ok(Self {
            pods: Api::namespaced(client.clone(), namespace),
            replica_sets: Api::namespaced(client, namespace),
        })
    }
}

pub fn deletion_parameters(uid: &str) -> Result<DeleteParams> {
    ensure!(!uid.is_empty(), "empty UID deletion is forbidden");
    Ok(DeleteParams {
        grace_period_seconds: Some(0),
        preconditions: Some(Preconditions {
            uid: Some(uid.into()),
            resource_version: None,
        }),
        ..Default::default()
    })
}

#[async_trait]
impl Cluster for Kubernetes {
    async fn pods(&self) -> Result<Vec<Pod>> {
        let response = self
            .pods
            .list(&ListParams::default().labels(ENABLED_SELECTOR).limit(100))
            .await?;
        ensure!(
            response
                .metadata
                .continue_
                .as_deref()
                .unwrap_or("")
                .is_empty(),
            "lab exceeds the 100 pod observation bound"
        );
        Ok(response.items)
    }
    async fn pod(&self, name: &str) -> Result<Option<Pod>> {
        Ok(self.pods.get_opt(name).await?)
    }
    async fn replica_set(&self, name: &str) -> Result<ReplicaSet> {
        Ok(self.replica_sets.get(name).await?)
    }
    async fn delete_uid(&self, name: &str, uid: &str) -> Result<DeleteOutcome> {
        match self.pods.delete(name, &deletion_parameters(uid)?).await {
            Ok(_) => Ok(DeleteOutcome::Accepted),
            Err(kube::Error::Api(response)) if response.code == 404 => {
                Ok(DeleteOutcome::AlreadyGone)
            }
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deletion_always_carries_uid_precondition() {
        assert!(deletion_parameters("").is_err());
        let parameters = deletion_parameters("immutable-victim").unwrap();
        assert_eq!(
            parameters.preconditions.unwrap().uid.as_deref(),
            Some("immutable-victim")
        );
    }
}
