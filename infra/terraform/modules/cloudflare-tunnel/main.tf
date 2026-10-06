terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26.0"
    }
  }
}

variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "hostname" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.hostname))
    error_message = "Provide an existing valid hostname in your Cloudflare zone."
  }
}
variable "service_url" {
  type    = string
  default = "http://traefik.kube-system.svc.cluster.local:80"
  validation {
    condition     = startswith(var.service_url, "http://") || startswith(var.service_url, "https://")
    error_message = "Tunnel origin must be an HTTP(S) service."
  }
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "hydra" {
  account_id = var.account_id
  name       = "hydra"
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "hydra" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hydra.id
  config = {
    ingress = [
      { hostname = var.hostname, service = var.service_url },
      { service = "http_status:404" }
    ]
  }
}

resource "cloudflare_dns_record" "hydra" {
  zone_id = var.zone_id
  name    = var.hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.hydra.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "hydra" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hydra.id
}

output "tunnel_token" {
  value     = data.cloudflare_zero_trust_tunnel_cloudflared_token.hydra.token
  sensitive = true
}
output "url" { value = "https://${var.hostname}" }
