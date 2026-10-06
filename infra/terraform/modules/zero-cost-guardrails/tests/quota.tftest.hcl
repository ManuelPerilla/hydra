# These tests use only Terraform's built-in terraform_data resource. No cloud
# provider, credentials, account lookup, or billable infrastructure is involved.
variables {
  region      = "us-ashburn-1"
  home_region = "us-ashburn-1"
  tenancy_id  = "ocid1.tenancy.test"
  inventory = {
    verified_at             = timestamp()
    region                  = "us-ashburn-1"
    tenancy_id              = "ocid1.tenancy.test"
    always_free_only        = true
    paid_resources_reviewed = true
    existing_a1_ocpus       = 0
    existing_a1_memory_gb   = 0
    existing_storage_gb     = 0
    existing_volume_backups = 0
    observed_a1_ocpus       = 0
    observed_a1_memory_gb   = 0
    observed_storage_gb     = 0
    managed_a1_ocpus        = 0
    managed_a1_memory_gb    = 0
    managed_storage_gb      = 0
    managed_instance_ids    = []
    managed_data_volume_ids = []
    managed_boot_volume_ids = []
    terraform_state_sha256  = ""
  }
}

run "first_install_empty_account" {
  command = apply

  assert {
    condition     = terraform_data.verified.input.existing_a1_ocpus == 0 && terraform_data.verified.input.existing_storage_gb == 0
    error_message = "An empty Always Free account must permit the first fixed-budget Hydra deployment."
  }
}

run "update_reconciles_existing_hydra" {
  command = apply
  variables {
    inventory = merge(var.inventory, {
      observed_a1_ocpus       = 2
      observed_a1_memory_gb   = 12
      observed_storage_gb     = 100
      managed_a1_ocpus        = 2
      managed_a1_memory_gb    = 12
      managed_storage_gb      = 100
      managed_instance_ids    = ["ocid1.instance.hydra"]
      managed_data_volume_ids = ["ocid1.volume.hydra"]
      managed_boot_volume_ids = ["ocid1.bootvolume.hydra"]
      terraform_state_sha256  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
  }

  assert {
    condition     = terraform_data.verified.input.existing_a1_ocpus == 0 && terraform_data.verified.input.managed_a1_ocpus == 2 && terraform_data.verified.input.managed_storage_gb == 100
    error_message = "A state-reconciled Hydra update must not count the same compute or boot/data storage twice."
  }
}

run "reject_excess_compute" {
  command = plan
  variables {
    inventory = merge(var.inventory, {
      existing_a1_ocpus = 0.5
      observed_a1_ocpus = 0.5
    })
  }
  expect_failures = [terraform_data.verified]
}

run "reject_excess_storage" {
  command = plan
  variables {
    inventory = merge(var.inventory, {
      existing_storage_gb = 101
      observed_storage_gb = 101
    })
  }
  expect_failures = [terraform_data.verified]
}

run "reject_excess_backups" {
  command = plan
  variables {
    inventory = merge(var.inventory, {
      existing_volume_backups = 6
    })
  }
  expect_failures = [terraform_data.verified]
}
