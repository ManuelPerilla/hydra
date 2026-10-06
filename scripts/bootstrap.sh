#!/usr/bin/env bash
set -euo pipefail
hydra_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$hydra_root"
umask 077
docker info >/dev/null
if [[ ! -f .env ]]; then
  command -v openssl >/dev/null || { echo 'Install openssl to generate secrets.' >&2; exit 1; }
  {
    printf 'HYDRA_POSTGRES_PASSWORD=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
    printf 'HYDRA_AGENT_TOKEN=%s\n' "$(openssl rand -base64 48 | tr -d '\n')"
    printf 'HYDRA_DATA_PROTECTION_KEY=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
    printf 'HYDRA_AUTH_MODE=local\nHYDRA_PUBLIC_URL=http://localhost:8080\nHYDRA_X_ENABLED=false\n'
  } > .env
fi
# Do not source .env: treat it as data, never executable shell code.
hydra_get_env() { sed -n "s/^$1=//p" .env | head -n 1; }
hydra_password=$(hydra_get_env HYDRA_POSTGRES_PASSWORD)
hydra_agent_token=$(hydra_get_env HYDRA_AGENT_TOKEN)
hydra_data_key=$(hydra_get_env HYDRA_DATA_PROTECTION_KEY)
for hydra_value in "$hydra_password" "$hydra_agent_token" "$hydra_data_key"; do
  [[ -n "$hydra_value" && "$hydra_value" != replace-* ]] || { echo 'Generate real .env secrets first.' >&2; exit 1; }
done
if [[ "${1:-}" == --compose ]]; then
  docker compose up -d --build
  echo 'Hydra UI: http://localhost:8080/es (compose has no Kubernetes chaos agent).'
  exit 0
fi
command -v k3d >/dev/null || { echo 'Install k3d before bootstrap.' >&2; exit 1; }
if ! k3d cluster list --no-headers | awk '{print $1}' | grep -qx hydra; then
  k3d cluster create --config infra/k3d/config.yaml
fi
if [[ "${1:-}" != --skip-build ]]; then
  docker build -t hydra-api:dev apps/api
  docker build -t hydra-agent:dev apps/chaos-agent
  docker build -t hydra-web:dev apps/web
fi
k3d image import hydra-api:dev hydra-agent:dev hydra-web:dev --cluster hydra
kubectl --context k3d-hydra apply -f infra/kubernetes/base/namespaces.yaml
mkdir -p .local
# Secrets go to files, never command-line arguments or stdout.
printf %s "$hydra_password" > .local/POSTGRES_PASSWORD
printf %s "$hydra_agent_token" > .local/AGENT_TOKEN
printf %s "$hydra_data_key" > .local/DATA_PROTECTION_KEY
printf %s http://localhost:8080 > .local/PUBLIC_URL
: > .local/GITHUB_CLIENT_ID
: > .local/GITHUB_CLIENT_SECRET
: > .local/ALLOWED_GITHUB_IDS
kubectl --context k3d-hydra -n hydra-system create secret generic hydra-runtime --from-file=.local/POSTGRES_PASSWORD --from-file=.local/AGENT_TOKEN --from-file=.local/DATA_PROTECTION_KEY --from-file=.local/PUBLIC_URL --from-file=.local/GITHUB_CLIENT_ID --from-file=.local/GITHUB_CLIENT_SECRET --from-file=.local/ALLOWED_GITHUB_IDS --dry-run=client -o yaml > .local/runtime-secret.yaml
kubectl --context k3d-hydra apply -f .local/runtime-secret.yaml
kubectl --context k3d-hydra apply -k infra/kubernetes/overlays/local
for hydra_workload in statefulset/postgres deployment/hydra-api deployment/hydra-web deployment/hydra-agent; do
  kubectl --context k3d-hydra -n hydra-system rollout status "$hydra_workload" --timeout=240s
done
kubectl --context k3d-hydra -n chaos-demo rollout status deployment/hydra-demo --timeout=120s
echo 'Hydra ready: http://localhost:8080/es. Local operator; dry-run first.'
