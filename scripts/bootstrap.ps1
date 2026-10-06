[CmdletBinding()]
param([switch]$Compose, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$hydraRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $hydraRoot
function Invoke-HydraNative([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
function New-HydraSecret([int]$Length = 32) {
  $hydraBytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($hydraBytes)
  return [Convert]::ToBase64String($hydraBytes)
}
Invoke-HydraNative docker @('info', '--format', '{{.OSType}}')
$hydraEnvPath = Join-Path $hydraRoot '.env'
if (-not (Test-Path -LiteralPath $hydraEnvPath)) {
  $hydraEnvLines = @(
    ('HYDRA_POSTGRES_PASSWORD=' + (New-HydraSecret)),
    ('HYDRA_AGENT_TOKEN=' + (New-HydraSecret 48)),
    ('HYDRA_DATA_PROTECTION_KEY=' + (New-HydraSecret)),
    'HYDRA_AUTH_MODE=local',
    'HYDRA_PUBLIC_URL=http://localhost:8080',
    'HYDRA_X_ENABLED=false'
  )
  [IO.File]::WriteAllLines($hydraEnvPath, $hydraEnvLines)
}
$hydraConfig = @{}
foreach ($hydraLine in [IO.File]::ReadAllLines($hydraEnvPath)) {
  if ($hydraLine -match '^([A-Z_]+)=(.*)$') { $hydraConfig[$Matches[1]] = $Matches[2] }
}
foreach ($hydraKey in @('HYDRA_POSTGRES_PASSWORD', 'HYDRA_AGENT_TOKEN', 'HYDRA_DATA_PROTECTION_KEY')) {
  if (-not $hydraConfig[$hydraKey] -or $hydraConfig[$hydraKey] -match '^replace-') {
    throw "Set a real generated $hydraKey in .env. Secrets are never printed."
  }
}
if ($Compose) {
  $hydraComposeArguments = @('compose', 'up', '-d')
  if (-not $SkipBuild) { $hydraComposeArguments += '--build' }
  Invoke-HydraNative docker $hydraComposeArguments
  Write-Output 'Hydra UI: http://localhost:8080/es (compose has no Kubernetes chaos agent).'
  exit 0
}
$hydraK3d = if (Test-Path -LiteralPath '.tools/k3d.exe') { Join-Path $hydraRoot '.tools/k3d.exe' } else { 'k3d' }
$hydraClustersJson = & $hydraK3d cluster list -o json
if ($LASTEXITCODE -ne 0) { throw 'Install k3d before bootstrap.' }
$hydraClusters = $hydraClustersJson | ConvertFrom-Json
if (-not ($hydraClusters | Where-Object name -eq 'hydra')) {
  Invoke-HydraNative $hydraK3d @('cluster', 'create', '--config', 'infra/k3d/config.yaml')
}
if (-not $SkipBuild) {
  foreach ($hydraComponent in @(@('api', 'api'), @('agent', 'chaos-agent'), @('web', 'web'))) {
    Invoke-HydraNative docker @('build', '--tag', ('hydra-' + $hydraComponent[0] + ':dev'), ('apps/' + $hydraComponent[1]))
  }
}
Invoke-HydraNative $hydraK3d @('image', 'import', 'hydra-api:dev', 'hydra-agent:dev', 'hydra-web:dev', '--cluster', 'hydra')
Invoke-HydraNative kubectl @('--context', 'k3d-hydra', 'apply', '-f', 'infra/kubernetes/base/namespaces.yaml')
$hydraData = @{}
$hydraSecretValues = @{
  POSTGRES_PASSWORD = $hydraConfig.HYDRA_POSTGRES_PASSWORD
  AGENT_TOKEN = $hydraConfig.HYDRA_AGENT_TOKEN
  DATA_PROTECTION_KEY = $hydraConfig.HYDRA_DATA_PROTECTION_KEY
  GITHUB_CLIENT_ID = ''
  GITHUB_CLIENT_SECRET = ''
  ALLOWED_GITHUB_IDS = ''
  PUBLIC_URL = 'http://localhost:8080'
}
foreach ($hydraEntry in $hydraSecretValues.GetEnumerator()) {
  $hydraData[$hydraEntry.Key] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($hydraEntry.Value))
}
$hydraSecret = @{apiVersion = 'v1'; kind = 'Secret'; metadata = @{name = 'hydra-runtime'; namespace = 'hydra-system'}; type = 'Opaque'; data = $hydraData}
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$hydraSecretPath = Join-Path $hydraRoot '.local/runtime-secret.json'
[IO.File]::WriteAllText($hydraSecretPath, ($hydraSecret | ConvertTo-Json -Depth 8))
Invoke-HydraNative kubectl @('--context', 'k3d-hydra', 'apply', '-f', $hydraSecretPath)
Invoke-HydraNative kubectl @('--context', 'k3d-hydra', 'apply', '-k', 'infra/kubernetes/overlays/local')
foreach ($hydraWorkload in @('statefulset/postgres', 'deployment/hydra-api', 'deployment/hydra-web', 'deployment/hydra-agent')) {
  Invoke-HydraNative kubectl @('--context', 'k3d-hydra', '-n', 'hydra-system', 'rollout', 'status', $hydraWorkload, '--timeout=240s')
}
Invoke-HydraNative kubectl @('--context', 'k3d-hydra', '-n', 'chaos-demo', 'rollout', 'status', 'deployment/hydra-demo', '--timeout=120s')
Write-Output 'Hydra ready: http://localhost:8080/es. Local operator; dry-run first.'
