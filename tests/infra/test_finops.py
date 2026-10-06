import hashlib
import importlib.util
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace as Model
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("preflight", ROOT / "scripts/oci-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)
INSTANCE = "ocid1.instance.hydra"
DATA = "ocid1.volume.hydra"
BOOT = "ocid1.bootvolume.hydra"
TAGS = {"project": "hydra", "finops": "always-free-only"}
CONFIG = {"tenancy": "ocid1.tenancy.test", "region": "us-ashburn-1"}


def export_state(instance=True, volume=True):
    resources = []
    for present, resource_type, name, resource_id in [
        (instance, "oci_core_instance", "hydra", INSTANCE),
        (volume, "oci_core_volume", "data", DATA),
    ]:
        if present:
            resources.append({"address": f"module.runtime.{resource_type}.{name}", "type": resource_type,
                              "mode": "managed", "values": {"id": resource_id}})
    return {"format_version": "1.0", "values": {"root_module": {
        "child_modules": [{"address": "module.runtime", "resources": resources}]}}}


def fake_sdk(instances=(), volumes=(), boots=(), containers=(), backups=(), boot_attachments=None):
    def response(values):
        return lambda *args, **kwargs: Model(data=values)
    identity = Model(list_region_subscriptions=response([Model(region_name="us-ashburn-1", is_home_region=True)]),
                     list_compartments=response([]), list_availability_domains=response([Model(name="AD-1")]))
    if boot_attachments is None:
        boot_attachments = [Model(boot_volume_id=BOOT, lifecycle_state="ATTACHED")]
    compute = Model(list_instances=response(list(instances)), list_boot_volume_attachments=response(boot_attachments))
    block = Model(list_volumes=response(list(volumes)), list_boot_volumes=response(list(boots)),
                  list_volume_backups=response(list(backups)), list_boot_volume_backups=response([]))
    ci = Model(list_container_instances=response(list(containers) if isinstance(containers, tuple) else containers))
    return Model(identity=Model(IdentityClient=lambda _: identity), core=Model(
        ComputeClient=lambda _: compute, BlockstorageClient=lambda _: block),
        container_instances=Model(ContainerInstanceClient=lambda _: ci),
        pagination=Model(list_call_get_all_results=lambda method, *args, **kwargs: method(*args, **kwargs)))


def a1(resource_id=INSTANCE, ocpus=2, memory=12, tags=None):
    return Model(id=resource_id, lifecycle_state="RUNNING", shape="VM.Standard.A1.Flex",
                 availability_domain="AD-1", freeform_tags=TAGS if tags is None else tags,
                 shape_config=Model(ocpus=ocpus, memory_in_gbs=memory))


def volume(resource_id, size=50, tags=None):
    return Model(id=resource_id, size_in_gbs=size, lifecycle_state="AVAILABLE",
                 freeform_tags=TAGS if tags is None else tags)


class FinOpsTests(unittest.TestCase):
    def scan(self, sdk, state=None):
        return preflight.inventory(CONFIG, sdk, True, True, state,
                                   hashlib.sha256(b"private-terraform-export").hexdigest() if state else "")

    def test_handles_both_sdk_normalized_list_and_container_collection(self):
        values = [Model(shape="CI.Standard.A1.Flex")]
        self.assertEqual(values, preflight.collection_items(values))
        self.assertEqual(values, preflight.collection_items(Model(items=values)))
        with self.assertRaises(ValueError):
            preflight.collection_items({"items": values})

    def test_first_deployment_reserves_full_budget_without_existing_resources(self):
        result = self.scan(fake_sdk(containers=Model(items=[])))
        self.assertEqual(0, result["existing_a1_ocpus"])
        self.assertEqual([], result["managed_instance_ids"])
        self.assertEqual(0, result["observed_storage_gb"])

    def test_update_does_not_count_managed_compute_and_boot_data_twice(self):
        result = self.scan(fake_sdk(instances=[a1()], volumes=[volume(DATA)],
                                    boots=[volume(BOOT)]), export_state())
        self.assertEqual((0, 0, 0), (result["existing_a1_ocpus"], result["existing_a1_memory_gb"], result["existing_storage_gb"]))
        self.assertEqual((2, 12, 100), (result["observed_a1_ocpus"], result["observed_a1_memory_gb"], result["managed_storage_gb"]))
        self.assertEqual([BOOT], result["managed_boot_volume_ids"])

    def test_tags_alone_never_exclude_resources_without_terraform_ids(self):
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(instances=[a1()], volumes=[volume(DATA)], boots=[volume(BOOT)]))

    def test_unmanaged_a1_and_container_allocations_share_the_free_pool(self):
        for sdk in [fake_sdk(instances=[a1("ocid1.instance.other", .5, 3)]),
                    fake_sdk(containers=Model(items=[a1("ocid1.containerinstance.other", .5, 3)])),
                    fake_sdk(containers=[a1("ocid1.containerinstance.other", .5, 3)])]:
            with self.assertRaises(ValueError):
                self.scan(sdk)

    def test_account_storage_outside_hydra_is_still_counted(self):
        result = self.scan(fake_sdk(instances=[a1()], volumes=[volume(DATA), volume("ocid1.volume.other", 99)],
                                    boots=[volume(BOOT)]), export_state())
        self.assertEqual(99, result["existing_storage_gb"])
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(volumes=[volume("ocid1.volume.other", 101)]))

    def test_partial_managed_creation_reserves_missing_resources(self):
        result = self.scan(fake_sdk(volumes=[volume(DATA)]), export_state(instance=False))
        self.assertEqual(50, result["managed_storage_gb"])
        self.assertEqual(0, result["existing_storage_gb"])
        self.assertEqual([], result["managed_instance_ids"])

    def test_stale_state_or_wrong_tags_are_never_accepted_as_exclusions(self):
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(), export_state())
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(instances=[a1(tags={})], volumes=[volume(DATA)], boots=[volume(BOOT)]), export_state())
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(volumes=[volume(DATA, tags={})]), export_state(instance=False))

    def test_missing_boot_attachment_refuses_unproven_storage_exclusion(self):
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(instances=[a1()], volumes=[volume(DATA)], boots=[volume(BOOT)], boot_attachments=[]), export_state())

    def test_raw_state_format_and_unrelated_addresses_cannot_hide_allocations(self):
        with self.assertRaises(ValueError):
            preflight.managed_resources({"version": 4})
        state = export_state()
        state["values"]["root_module"]["child_modules"][0]["resources"][0]["address"] = "module.other.oci_core_instance.hydra"
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(instances=[a1()], volumes=[volume(DATA)], boots=[volume(BOOT)]), state)

    def test_backups_and_unknown_shape_allocations_fail_closed(self):
        with self.assertRaises(ValueError):
            self.scan(fake_sdk(backups=[Model(lifecycle_state="AVAILABLE")] * 6))
        for value in [float("nan"), float("inf"), -1]:
            with self.assertRaises(ValueError):
                self.scan(fake_sdk(instances=[a1(ocpus=value)]))


class OracleBootTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cloud = yaml.safe_load((ROOT / "infra/terraform/modules/oracle-arm/cloud-init.yaml").read_text())
        cls.files = {file["path"]: file["content"] for file in cloud["write_files"]}

    @unittest.skipUnless(shutil.which("sh"), "Requires POSIX sh; runs on Linux CI")
    def test_failed_mount_prevents_every_install_command(self):
        script = self.files["/usr/local/sbin/hydra-bootstrap"].splitlines()
        mount = script.index("/usr/local/sbin/hydra-mount-data")
        # Execute the actual shell preamble with a failing mount. Replace every
        # later operation by a marker, so the regression test never touches a host.
        harmless = "\n".join(script[:mount]) + "\nfalse\nprintf 'UNSAFE_CONTINUATION\\n'\n"
        result = subprocess.run([shutil.which("sh"), "-s"], input=harmless, text=True, capture_output=True)
        self.assertNotEqual(0, result.returncode)
        self.assertNotIn("UNSAFE_CONTINUATION", result.stdout)

    def test_reboots_require_mount_and_keep_all_k3s_storage_on_data_disk(self):
        unit = self.files["/etc/systemd/system/k3s.service.d/hydra-storage.conf"]
        self.assertIn("RequiresMountsFor=/srv/hydra", unit)
        self.assertIn("ExecStartPre=/usr/bin/mountpoint -q /srv/hydra", unit)
        config = yaml.safe_load(self.files["/etc/rancher/k3s/config.yaml"])
        self.assertTrue(config["data-dir"].startswith("/srv/hydra/"))
        self.assertTrue(config["default-local-storage-path"].startswith("/srv/hydra/"))
        self.assertNotIn("nofail", self.files["/usr/local/sbin/hydra-mount-data"])
        self.assertIn("Requires=hydra-firewall.service", unit)


if __name__ == "__main__":
    unittest.main()
