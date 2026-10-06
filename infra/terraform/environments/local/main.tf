terraform {
  required_version = ">= 1.9, < 2.0"
}
module "runtime" {
  source      = "../../modules/local-runtime"
  config_path = abspath("${path.module}/../../../k3d/config.yaml")
}
output "context" {
  value = module.runtime.context
}
