terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.8.0"
    }
  }
}

variable "compartment_id" { type = string }
variable "tenancy_id" { type = string }
variable "availability_domain" { type = string }
variable "ssh_public_key" { type = string }
variable "admin_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && !contains(["0.0.0.0/0", "::/0"], var.admin_cidr)
    error_message = "SSH must be restricted to your administrator CIDR."
  }
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}
resource "oci_core_vcn" "hydra" {
  compartment_id = var.compartment_id
  cidr_blocks    = ["10.88.0.0/16"]
  display_name   = "hydra"
  dns_label      = "hydra"
}
resource "oci_core_internet_gateway" "hydra" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.hydra.id
  enabled        = true
}
resource "oci_core_route_table" "hydra" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.hydra.id
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.hydra.id
  }
}
resource "oci_core_security_list" "hydra" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.hydra.id
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
  dynamic "ingress_security_rules" {
    for_each = { ssh = { port = 22, cidr = var.admin_cidr }, http = { port = 80, cidr = "0.0.0.0/0" }, https = { port = 443, cidr = "0.0.0.0/0" } }
    content {
      protocol = "6"
      source   = ingress_security_rules.value.cidr
      tcp_options {
        min = ingress_security_rules.value.port
        max = ingress_security_rules.value.port
      }
    }
  }
}
resource "oci_core_subnet" "hydra" {
  compartment_id    = var.compartment_id
  vcn_id            = oci_core_vcn.hydra.id
  cidr_block        = "10.88.1.0/24"
  route_table_id    = oci_core_route_table.hydra.id
  security_list_ids = [oci_core_security_list.hydra.id]
  dns_label         = "runtime"
}
resource "oci_core_instance" "hydra" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_id
  display_name        = "hydra-arm"
  shape               = "VM.Standard.A1.Flex"
  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }
  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = 50
    boot_volume_vpus_per_gb = 10
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.hydra.id
    assign_public_ip = false
    hostname_label   = "hydra"
  }
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }
  freeform_tags = { project = "hydra", finops = "always-free-only" }
  lifecycle { prevent_destroy = true }
}
data "oci_core_vnic_attachments" "hydra" {
  compartment_id = var.compartment_id
  instance_id    = oci_core_instance.hydra.id
}
data "oci_core_private_ips" "hydra" {
  vnic_id = data.oci_core_vnic_attachments.hydra.vnic_attachments[0].vnic_id
}
resource "oci_core_public_ip" "hydra" {
  compartment_id = var.compartment_id
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.hydra.private_ips[0].id
  display_name   = "hydra-stable-ip"
  lifecycle { prevent_destroy = true }
}
resource "oci_core_volume" "data" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_id
  display_name        = "hydra-data"
  size_in_gbs         = 50
  vpus_per_gb         = 10
  freeform_tags       = { project = "hydra", finops = "always-free-only" }
  lifecycle { prevent_destroy = true }
}
resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.hydra.id
  volume_id       = oci_core_volume.data.id
  device          = "/dev/oracleoci/oraclevdb"
}
output "public_ip" { value = oci_core_public_ip.hydra.ip_address }
output "instance_id" { value = oci_core_instance.hydra.id }
output "data_volume_id" { value = oci_core_volume.data.id }
