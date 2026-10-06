import importlib.util
import copy
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("policy", ROOT / "scripts/check-infra.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def test_refuses_namespace_escape(self):
        doc = {"kind": "Role", "metadata": {"name": "bad", "namespace": "kube-system"}, "rules": []}
        self.assertTrue(policy.validate_documents([doc]))

    def test_refuses_secret_or_node_permissions(self):
        for resource in ("secrets", "nodes", "pods/exec"):
            doc = {"kind": "Role", "metadata": {"namespace": "chaos-demo"}, "rules": [{"resources": [resource], "verbs": ["get"]}]}
            self.assertTrue(policy.validate_documents([doc]))

    def test_refuses_unbounded_replication_and_billable_load_balancer(self):
        self.assertTrue(policy.validate_documents([{"kind": "HorizontalPodAutoscaler", "spec": {"maxReplicas": 4}}]))
        self.assertTrue(policy.validate_documents([{"kind": "Service", "spec": {"type": "LoadBalancer"}}]))

    def test_permits_only_laboratory_pod_delete_and_controller_read(self):
        doc = {"kind": "Role", "metadata": {"namespace": "chaos-demo"}, "rules": [
            {"apiGroups": [""], "resources": ["pods"], "verbs": ["get", "list", "watch", "delete"]},
            {"apiGroups": ["apps"], "resources": ["replicasets"], "verbs": ["get"]},
        ]}
        self.assertEqual([], policy.validate_documents([doc]))

    def test_refuses_wildcard_api_groups(self):
        doc = {"kind": "Role", "metadata": {"namespace": "chaos-demo"}, "rules": [
            {"apiGroups": ["*"], "resources": ["pods"], "verbs": ["delete"]},
        ]}
        self.assertTrue(policy.validate_documents([doc]))

    def test_refuses_binding_admin_or_another_identity(self):
        binding = {"kind": "RoleBinding", "metadata": {"namespace": "chaos-demo"},
                   "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": "hydra-chaos"},
                   "subjects": [{"kind": "ServiceAccount", "name": "hydra-agent", "namespace": "hydra-system"}]}
        self.assertEqual([], policy.validate_documents([binding]))
        for altered in (dict(binding, roleRef={"apiGroup": "rbac.authorization.k8s.io", "kind": "ClusterRole", "name": "cluster-admin"}),
                        dict(binding, subjects=[{"kind": "User", "name": "external-user"}])):
            self.assertTrue(policy.validate_documents([altered]))

    def test_refuses_root_hostpath_and_unnecessary_token(self):
        safe = {"kind": "Deployment", "metadata": {"name": "web"}, "spec": {"template": {"spec": {
            "automountServiceAccountToken": False, "securityContext": {"runAsNonRoot": True, "runAsUser": 1001},
            "containers": [{"resources": {"requests": {"cpu": "10m", "memory": "16Mi"},
                                             "limits": {"cpu": "100m", "memory": "64Mi"}},
                            "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                                                "capabilities": {"drop": ["ALL"]}}}]}}}}
        self.assertEqual([], policy.validate_documents([safe]))
        for change in ("root", "hostpath", "token", "requests"):
            altered = copy.deepcopy(safe)
            pod = altered["spec"]["template"]["spec"]
            if change == "root":
                pod["containers"][0]["securityContext"]["runAsUser"] = 0
            elif change == "hostpath":
                pod["volumes"] = [{"name": "host", "hostPath": {"path": "/etc"}}]
            elif change == "token":
                pod["automountServiceAccountToken"] = True
            else:
                del pod["containers"][0]["resources"]["requests"]
            self.assertTrue(policy.validate_documents([altered]), change)


if __name__ == "__main__":
    unittest.main()
