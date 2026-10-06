# Monorepo Hydra

Estructura implementada. Se omiten dependencias, artefactos compilados y herramientas locales. Secretos, state Terraform y evidencia local quedan fuera de Git.

```text
hydra/
├── README.md, LICENSE, CHANGELOG.md
├── CODE_OF_CONDUCT.md, CONTRIBUTING.md
├── GOVERNANCE.md, MAINTAINERS.md, SECURITY.md, SUPPORT.md
├── .editorconfig, .gitattributes, .gitignore, .env.example
├── compose.yaml
├── .github/
│   ├── CODEOWNERS, dependabot.yml, PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   │   └── config.yml, bug_report.yml, feature_request.yml, documentation.yml, finops.yml
│   └── workflows/
│       ├── ci.yml                         # pruebas nativas amd64/arm64; validación infra
│       ├── containers-multiarch.yml       # builds, manifests OCI, SBOM/provenance
│       ├── welcome.yml                    # bienvenida sobre metadatos
│       └── label.yml                      # etiquetas de issues y paths de PR
├── apps/
│   ├── api/
│   │   ├── Hydra.sln, global.json, Directory.Build.props, Dockerfile, README.md
│   │   ├── src/Hydra.Api/
│   │   │   └── Program.cs, Contracts.cs, HydraStore.cs, Safety.cs, Telemetry.cs, DataProtection.cs
│   │   └── tests/Hydra.Api.Tests/
│   ├── chaos-agent/
│   │   ├── Cargo.toml, Cargo.lock, rust-toolchain.toml, Dockerfile, README.md
│   │   └── src/
│   │       └── main.rs, lib.rs, api.rs, config.rs, policy.rs, kubernetes.rs, experiment.rs, x.rs
│   └── web/
│       ├── package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json, Dockerfile, README.md
│       ├── src/app/                       # rutas [locale], estilos y healthz
│       ├── src/components/dashboard.tsx
│       ├── src/lib/                       # API y telemetría
│       ├── src/i18n/messages.ts           # es, en, pt, ar
│       ├── public/hydra-mark.svg
│       └── tests/
├── contracts/
│   ├── openapi/hydra-v1.yaml
│   └── events/chaos-event.schema.json
├── infra/
│   ├── terraform/
│   │   ├── modules/
│   │   │   └── local-runtime/, cloudflare-tunnel/, oracle-arm/, zero-cost-guardrails/
│   │   │       # zero-cost-guardrails/tests/quota.tftest.hcl
│   │   └── environments/                 # main.tf, locks y ejemplos cuando aplica
│   │       └── local/, home-tunnel/, oracle/
│   ├── k3d/config.yaml
│   ├── gateway/nginx.conf
│   ├── kubernetes/
│   │   ├── base/                         # runtime, laboratorio, RBAC y políticas
│   │   └── overlays/local/, home-tunnel/, oracle-arm/
│   │       # Oracle incluye ACME por PV/PVC y TLSStore para clientes sin SNI
│   └── certificates/
│       └── renew-ip.sh, hydra-cert-renew.service, hydra-cert-renew.timer
├── scripts/
│   ├── bootstrap.ps1, bootstrap.sh
│   ├── smoke.py                          # simulación, idempotencia y borrado local opcional
│   ├── oci-preflight.py                  # inventario read-only de cuenta OCI
│   └── check-infra.py                    # políticas de Kubernetes
├── tests/infra/                          # regresiones de políticas y cuotas
└── docs/
    ├── architecture/c4.md, monorepo.md
    ├── adr/0001-zero-cost-multiarch.md, 0002-implementation-safety.md
    ├── runbooks/home-tunnel.md, oracle-arm.md, emergency-stop.md
    ├── community/discord.md, launch-day-1.md, component-campaigns.md
    ├── finops/resource-budget.md
    └── validation/local-2026-10-04.md
        # assets/hydra-console.jpg: captura local verificada
```

Los contratos documentan la compatibilidad entre API, frontend y agente. Los workflows consumen los Dockerfiles de cada componente y forman un manifiesto OCI por imagen.

Las comprobaciones de infraestructura viven en CI junto con las pruebas de aplicación. El workflow de contenedores invoca la validación antes de publicar; evita una segunda ejecución independiente de CI por push.

Bienvenida y etiquetas actúan sobre metadatos con permisos limitados. Los PR de forks se verifican sin secretos. El etiquetado consulta la API de GitHub desde la rama principal; no ejecuta contenido de forks con credenciales privilegiadas. Actions fijadas por SHA. Los jobs se limitan a repositorios públicos para conservar el perfil gratuito.

El servidor Discord y el repositorio remoto aún no se han creado desde este workspace. CODEOWNERS y canales de contacto requieren responsables reales antes de la apertura pública.
