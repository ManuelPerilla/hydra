terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26.0"
    }
  }
}

# CLOUDFLARE_API_TOKEN from the environment; never commit it.
provider "cloudflare" {}
variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "hostname" { type = string }
module "tunnel" {
  source     = "../../modules/cloudflare-tunnel"
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.hostname
}
output "tunnel_token" {
  value     = module.tunnel.tunnel_token
  sensitive = true
}
output "url" { value = module.tunnel.url }
