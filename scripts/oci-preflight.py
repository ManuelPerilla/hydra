"""Read-only OCI account inventory. Requires the official oci Python SDK.

Usage: python scripts/oci-preflight.py --always-free-only --paid-resources-reviewed
For an update, first export `terraform show -json` to a private local file and
pass --terraform-state FILE. Only exact runtime resource IDs are reconciled.
No mutations, no credentials printed. Missing permissions abort the inventory.
"""
import argparse
import json
import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path


def collection_items(data):
    """Pagination normally unwraps OCI collections; tolerate unwrapped responses."""
    items = data if isinstance(data, list) else getattr(data, "items", None)
    if not isinstance(items, list):
        raise ValueError("Unsupported OCI list response; refusing an incomplete inventory.")
    return items


def managed_resources(state: dict | None) -> dict:
    result = {"instances": set(), "volumes": set()}
    if state is None:
        return result
    if not str(state.get("format_version", "")).startswith("1."):
        raise ValueError("Use an unmodified terraform show -json export, not a raw tfstate file.")
    expected = {
        "module.runtime.oci_core_instance.hydra": ("oci_core_instance", "instances", "ocid1.instance."),
        "module.runtime.oci_core_volume.data": ("oci_core_volume", "volumes", "ocid1.volume."),
    }
    def walk(module):
        for resource in module.get("resources", []):
            address = resource.get("address")
            if address not in expected:
                continue
            resource_type, category, prefix = expected[address]
            value = resource.get("values", {}).get("id", "")
            if resource.get("mode") != "managed" or resource.get("type") != resource_type or not value.startswith(prefix):
                raise ValueError(f"Invalid managed identity at {address}.")
            result[category].add(value)
        for child in module.get("child_modules", []):
            walk(child)
    walk(state.get("values", {}).get("root_module", {}))
    if any(len(values) > 1 for values in result.values()):
        raise ValueError("Only one Hydra instance and one data volume can be excluded.")
    return result


def allocation(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"Cannot determine {label}; refusing inventory.")
    return value


def check_budget(observed, managed):
    outside = {key: observed[key] - managed[key] for key in ("ocpus", "memory", "storage")}
    if any(value < 0 for value in outside.values()):
        raise ValueError("Managed exclusions exceed the observed account allocation.")
    if observed["ocpus"] > 2 or observed["memory"] > 12 or observed["storage"] > 200 or observed["backups"] > 5:
        raise ValueError("Current account allocation already exceeds conservative Always Free allowances.")
    if managed["ocpus"] > 2 or managed["memory"] > 12 or managed["storage"] > 100:
        raise ValueError("Managed Hydra allocation exceeds its fixed deployment budget.")
    if outside["ocpus"] + 2 > 2 or outside["memory"] + 12 > 12 or outside["storage"] + 100 > 200:
        raise ValueError("Account-wide allocation after reconciliation would exceed Always Free allowances.")
    return outside


def inventory(config: dict, sdk, free_only: bool, reviewed: bool, state: dict | None = None, state_hash: str = "") -> dict:
    if not free_only or not reviewed:
        raise ValueError("Both account eligibility confirmations are mandatory.")
    owned = managed_resources(state)
    identity = sdk.identity.IdentityClient(config)
    tenancy = config["tenancy"]
    regions = identity.list_region_subscriptions(tenancy).data
    home = next(region.region_name for region in regions if region.is_home_region)
    if config["region"] != home:
        raise ValueError("Use the tenancy home region in ~/.oci/config.")
    compartments = sdk.pagination.list_call_get_all_results(
        identity.list_compartments, tenancy,
        compartment_id_in_subtree=True, access_level="ANY",
    ).data
    ids = sorted({tenancy, *[c.id for c in collection_items(compartments) if c.lifecycle_state == "ACTIVE"]})
    ads = identity.list_availability_domains(tenancy).data
    compute = sdk.core.ComputeClient(config)
    block = sdk.core.BlockstorageClient(config)
    containers = sdk.container_instances.ContainerInstanceClient(config)
    observed = {"ocpus": 0, "memory": 0, "storage": 0, "backups": 0}
    managed = {"ocpus": 0, "memory": 0, "storage": 0}
    seen_instances, seen_volumes, seen_boots = set(), set(), set()
    expected_boots = set()
    for compartment in ids:
        instances = sdk.pagination.list_call_get_all_results(compute.list_instances, compartment).data
        for instance in collection_items(instances):
            if instance.lifecycle_state == "TERMINATED":
                continue
            if "Standard.A1" in instance.shape:
                if instance.shape_config is None:
                    raise ValueError("Cannot determine A1 shape allocation; manual review required.")
                cpu = allocation(instance.shape_config.ocpus, "A1 OCPUs")
                ram = allocation(instance.shape_config.memory_in_gbs, "A1 memory")
                observed["ocpus"] += cpu
                observed["memory"] += ram
                if instance.id in owned["instances"]:
                    if (instance.freeform_tags or {}).get("project") != "hydra" or (instance.freeform_tags or {}).get("finops") != "always-free-only":
                        raise ValueError("Managed instance identity lacks Hydra ownership tags.")
                    seen_instances.add(instance.id)
                    managed["ocpus"] += cpu
                    managed["memory"] += ram
                    attachments = sdk.pagination.list_call_get_all_results(
                        compute.list_boot_volume_attachments, instance.availability_domain,
                        compartment, instance_id=instance.id,
                    ).data
                    boots = [attachment.boot_volume_id for attachment in collection_items(attachments)
                             if attachment.lifecycle_state == "ATTACHED"]
                    if len(boots) != 1:
                        raise ValueError("Cannot identify exactly one attached managed boot volume.")
                    expected_boots.update(boots)
        cis = sdk.pagination.list_call_get_all_results(containers.list_container_instances, compartment).data
        for instance in collection_items(cis):
            if instance.lifecycle_state not in ("DELETED", "TERMINATED") and "Standard.A1" in instance.shape:
                if instance.shape_config is None:
                    raise ValueError("Cannot determine A1 Container Instance allocation.")
                observed["ocpus"] += allocation(instance.shape_config.ocpus, "Container Instance OCPUs")
                observed["memory"] += allocation(instance.shape_config.memory_in_gbs, "Container Instance memory")
        volumes = sdk.pagination.list_call_get_all_results(block.list_volumes, compartment).data
        for volume in collection_items(volumes):
            if volume.lifecycle_state == "TERMINATED":
                continue
            size = allocation(volume.size_in_gbs, "block volume size")
            observed["storage"] += size
            if volume.id in owned["volumes"]:
                if (volume.freeform_tags or {}).get("project") != "hydra" or (volume.freeform_tags or {}).get("finops") != "always-free-only":
                    raise ValueError("Managed data volume lacks Hydra ownership tags.")
                seen_volumes.add(volume.id)
                managed["storage"] += size
        for ad in ads:
            boots = sdk.pagination.list_call_get_all_results(block.list_boot_volumes, ad.name, compartment).data
            for volume in collection_items(boots):
                if volume.lifecycle_state == "TERMINATED":
                    continue
                size = allocation(volume.size_in_gbs, "boot volume size")
                observed["storage"] += size
                if volume.id in expected_boots:
                    seen_boots.add(volume.id)
                    managed["storage"] += size
        for method in (block.list_volume_backups, block.list_boot_volume_backups):
            values = sdk.pagination.list_call_get_all_results(method, compartment).data
            observed["backups"] += sum(v.lifecycle_state != "TERMINATED" for v in collection_items(values))
    if seen_instances != owned["instances"] or seen_volumes != owned["volumes"] or seen_boots != expected_boots:
        raise ValueError("Terraform resource IDs are stale, inaccessible, or outside the inventoried home region; refresh the state export.")
    if (seen_instances or seen_volumes) and (len(state_hash) != 64 or any(c not in "0123456789abcdef" for c in state_hash)):
        raise ValueError("Managed exclusions require the SHA-256 of the supplied state export.")
    outside = check_budget(observed, managed)
    return {
        "verified_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "region": home,
        "tenancy_id": tenancy,
        "always_free_only": free_only,
        "existing_a1_ocpus": outside["ocpus"],
        "existing_a1_memory_gb": outside["memory"],
        "existing_storage_gb": outside["storage"],
        "existing_volume_backups": observed["backups"],
        "observed_a1_ocpus": observed["ocpus"],
        "observed_a1_memory_gb": observed["memory"],
        "observed_storage_gb": observed["storage"],
        "managed_a1_ocpus": managed["ocpus"],
        "managed_a1_memory_gb": managed["memory"],
        "managed_storage_gb": managed["storage"],
        "managed_instance_ids": sorted(seen_instances),
        "managed_data_volume_ids": sorted(seen_volumes),
        "managed_boot_volume_ids": sorted(seen_boots),
        "terraform_state_sha256": state_hash,
        "paid_resources_reviewed": reviewed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--always-free-only", action="store_true", help="Confirm account is Always-Free-only, without paid/trial fallback.")
    parser.add_argument("--paid-resources-reviewed", action="store_true", help="Confirm eligibility, networking/egress and other account resources reviewed in OCI console.")
    parser.add_argument("--output", type=Path, default=Path(".local/oci-inventory.json"))
    parser.add_argument("--terraform-state", type=Path, help="Private, fresh terraform show -json export for this Oracle environment; omit only for first deployment.")
    args = parser.parse_args()
    if not args.always_free_only or not args.paid_resources_reviewed:
        parser.error("Both account eligibility confirmations are required; an inventory cannot prove billing eligibility.")
    import oci
    state_bytes = args.terraform_state.read_bytes() if args.terraform_state else None
    state = json.loads(state_bytes) if state_bytes is not None else None
    state_hash = hashlib.sha256(state_bytes).hexdigest() if state_bytes is not None else ""
    result = inventory(oci.config.from_file(), oci, args.always_free_only, args.paid_resources_reviewed, state, state_hash)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Read-only inventory saved to {args.output}; expires after one hour.")


if __name__ == "__main__":
    main()
