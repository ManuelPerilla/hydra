# Contribuir a Hydra

Puedes contribuir código, documentación, traducciones, pruebas o reportes de cuotas. Revisa CODE_OF_CONDUCT.md y el ADR 0001 antes de cambiar el comportamiento de un experimento.

## Arranque gratuito con Docker

Instala Docker con contenedores Linux, k3d y kubectl. Disponibilidad recomendada: 6 GB de RAM para Docker. El bootstrap crea únicamente el clúster local `hydra`, genera secretos en archivos ignorados y aplica el laboratorio.

PowerShell, desde la raíz del repositorio:

```powershell
./scripts/bootstrap.ps1
```

Linux/macOS:

```sh
bash scripts/bootstrap.sh
```

Abre `http://localhost:8080/es`. El perfil local concede un operador de desarrollo, se expone solo en loopback y no requiere OAuth ni cuenta cloud. Ejecuta la simulación antes de autorizar un borrado real.

Objetivo menor de cinco minutos con imágenes construidas y herramientas instaladas: usa `-SkipBuild` en PowerShell o `--skip-build` en shell. El primer build descarga dependencias y no tiene duración garantizada. Los pasos están aislados de otras aplicaciones Docker.

Para trabajar en API/interfaz sin Kubernetes: `./scripts/bootstrap.ps1 -Compose` o `bash scripts/bootstrap.sh --compose`. Ese perfil no ejecuta borrados porque no incluye el agente Kubernetes.

## Verificar cambios

```sh
dotnet test apps/api/Hydra.sln
cd apps/chaos-agent
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

En `apps/web`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Las pruebas PostgreSQL usan `HYDRA_TEST_POSTGRES`, una conexión a una base desechable con permiso de crear bases de prueba. CI ejecuta estas pruebas en amd64 y arm64. Nunca uses una conexión de producción.

Infraestructura: `python -m pip install PyYAML==6.0.3`, `python scripts/check-infra.py` y `python -m unittest discover -s tests/infra -v`. La regresión de montaje necesita un shell POSIX; en Windows puedes usar el shell de Git durante esa ejecución. Las pruebas OCI usan respuestas simuladas y nunca consultan una cuenta real.

Para las cuotas Terraform, desde la raíz: `terraform -chdir=infra/terraform/modules/zero-cost-guardrails init` y `terraform -chdir=infra/terraform/modules/zero-cost-guardrails test`. Solo usan terraform_data local. Los jobs GitHub se omiten en repositorios privados para conservar el perfil gratuito.

## Enviar una contribución

Describe el problema, el cambio y pruebas realizadas. Firma commits con `git commit -s` para aceptar el [Developer Certificate of Origin](https://developercertificate.org/). No exigimos CLA. Usa el formulario de PR y limita cada cambio a un problema revisable.

Cambios en permisos, persistencia o cuotas requieren un ADR. Cambios que amplían el ámbito destructivo necesitan revisión de dos mantenedores cuando exista ese equipo. El namespace inicial es `chaos-demo`; ninguna prueba puede destruir otros workloads.

Los nuevos strings deben existir en español, inglés, portugués y árabe. Prueba RTL, teclado y reducción de movimiento. No añadas indicadores simulados que parezcan mediciones reales ni servicios de pago obligatorios.

## Comunidad

GitHub conserva issues y decisiones. Discord es conversación y acompañamiento, y aún necesita responsables e invitación real antes de abrirse. Puedes empezar por documentación y pruebas de seguridad sin conocer los tres lenguajes.
