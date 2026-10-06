"""Validate safety properties of the Kubernetes and Terraform source, without credentials."""
from pathlib import Path
import sys
import yaml

ROOT = Path(__file__).resolve().parent.parent


def validate_documents(documents):
    documents = list(documents)
    failures = []
    accounts = {(doc.get("metadata", {}).get("namespace"), doc.get("metadata", {}).get("name")):
                doc.get("automountServiceAccountToken", True)
                for doc in documents if isinstance(doc, dict) and doc.get("kind") == "ServiceAccount"}
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        kind = doc.get("kind")
        meta = doc.get("metadata", {})
        name = meta.get("name", "unnamed")
        if kind == "Role":
            if meta.get("namespace") != "chaos-demo":
                failures.append(f"{name}: chaos Role escaped the laboratory")
            for rule in doc["rules"]:
                allowed = {"pods": {"get", "list", "watch", "delete"}, "replicasets": {"get"}}
                groups = {"pods": {""}, "replicasets": {"apps"}}
                for resource in rule["resources"]:
                    if resource not in allowed or not set(rule["verbs"]) <= allowed.get(resource, set()):
                        failures.append(f"{name}: forbidden resource or verb {resource}")
                    if set(rule.get("apiGroups", [])) != groups.get(resource, set()):
                        failures.append(f"{name}: forbidden or missing API group for {resource}")
        if kind == "RoleBinding":
            expected_ref = {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": "hydra-chaos"}
            expected_subjects = [{"kind": "ServiceAccount", "name": "hydra-agent", "namespace": "hydra-system"}]
            if meta.get("namespace") != "chaos-demo" or doc.get("roleRef") != expected_ref or doc.get("subjects") != expected_subjects:
                failures.append(f"{name}: chaos binding grants an unexpected identity or role")
        if kind in {"ClusterRole", "ClusterRoleBinding"}:
            failures.append(f"{name}: cluster-wide grants are forbidden")
        if kind == "HorizontalPodAutoscaler" and doc["spec"].get("maxReplicas", 999) > 3:
            failures.append(f"{name}: HPA exceeds the Zero-Cost replica cap")
        if kind == "Service" and doc["spec"].get("type") == "LoadBalancer":
            failures.append(f"{name}: managed load balancer is forbidden")
        if kind in {"Deployment", "StatefulSet"}:
            pod = doc["spec"]["template"]["spec"]
            pod_security = pod.get("securityContext", {})
            if any("hostPath" in volume for volume in pod.get("volumes", [])):
                failures.append(f"{name}: direct hostPath in a pod violates restricted admission")
            token_mount = pod.get("automountServiceAccountToken", accounts.get((meta.get("namespace"), pod.get("serviceAccountName", "default")), True))
            if name != "hydra-agent" and token_mount is not False:
                failures.append(f"{name}: unnecessary Kubernetes token mount")
            for container in pod["containers"]:
                limits = container.get("resources", {}).get("limits", {})
                requests = container.get("resources", {}).get("requests", {})
                if any(resource not in limits or resource not in requests for resource in ("memory", "cpu")):
                    failures.append(f"{name}: container has unbounded CPU/RAM")
                security = container.get("securityContext", {})
                if security.get("runAsNonRoot", pod_security.get("runAsNonRoot")) is not True or security.get("runAsUser", pod_security.get("runAsUser")) == 0:
                    failures.append(f"{name}: nonroot execution is not enforced")
                if security.get("allowPrivilegeEscalation") is not False or security.get("readOnlyRootFilesystem") is not True:
                    failures.append(f"{name}: container privilege/filesystem policy missing")
                if "ALL" not in security.get("capabilities", {}).get("drop", []):
                    failures.append(f"{name}: Linux capabilities not dropped")
        if kind == "Secret":
            failures.append(f"{name}: runtime secrets must be generated outside tracked manifests")
    return failures


def main():
    docs = []
    for path in (ROOT / "infra/kubernetes/base").glob("*.yaml"):
        docs.extend(yaml.safe_load_all(path.read_text(encoding="utf-8")))
    for path in (ROOT / "infra/kubernetes/overlays").rglob("*.yaml"):
        # Strategic merge patches are partial resources, not complete workloads.
        if path.name in {"local-api.yaml", "ingress-tls.yaml", "kustomization.yaml"}:
            continue
        docs.extend(yaml.safe_load_all(path.read_text(encoding="utf-8")))
    failures = validate_documents(docs)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("Kubernetes policies passed: namespace scope, RBAC, replica caps, bounded resources and nonroot container policy.")


if __name__ == "__main__":
    main()
