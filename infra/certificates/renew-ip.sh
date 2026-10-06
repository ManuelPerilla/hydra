#!/usr/bin/env bash
# Execute on the Oracle node after the ACME challenge Ingress is installed.
set -euo pipefail
hydra_ip=${1:?Usage: renew-ip.sh PUBLIC_IP EMAIL}
hydra_email=${2:?Usage: renew-ip.sh PUBLIC_IP EMAIL}
[[ "$hydra_ip" =~ ^[0-9.]+$ ]] || { echo 'IPv4 address required.' >&2; exit 1; }
hydra_certbot=/opt/hydra/acme/bin/certbot
[[ -x "$hydra_certbot" ]] || { echo 'Install Certbot >=5.4 in /opt/hydra/acme first.' >&2; exit 1; }
"$hydra_certbot" certonly --non-interactive --agree-tos --email "$hydra_email" --preferred-profile shortlived --ip-address "$hydra_ip" --webroot --webroot-path /srv/hydra/acme
umask 077
mkdir -p /srv/hydra/secrets
kubectl -n hydra-system create secret tls hydra-tls --cert="/etc/letsencrypt/live/$hydra_ip/fullchain.pem" --key="/etc/letsencrypt/live/$hydra_ip/privkey.pem" --dry-run=client -o yaml > /srv/hydra/secrets/tls.yaml
kubectl apply -f /srv/hydra/secrets/tls.yaml
