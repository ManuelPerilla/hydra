terraform {
  required_version = ">= 1.9, < 2.0"
}

variable "config_path" {
  type = string
}

resource "terraform_data" "cluster" {
  input = {
    name        = "hydra"
    config_hash = filesha256(var.config_path)
  }
  provisioner "local-exec" {
    command = "k3d cluster create hydra --config \"${var.config_path}\""
  }
}

output "context" {
  value = "k3d-hydra"
}

# No destroy provisioner: Terraform must not delete an existing laboratory or data.
# Explicit teardown is documented separately and limited to the hydra cluster.
