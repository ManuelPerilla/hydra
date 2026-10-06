# Hydra

> Corta una cabeza y dos más tomarán su lugar.

**Rompe un pod. Observa la recuperación. Conserva la evidencia.**

Hydra es una plataforma Open Source de Chaos Engineering. Selecciona un pod autorizado, valida el experimento y pulsa **INJECT CHAOS**. Kubernetes repone la réplica y la consola transmite el resultado por WebSocket.

Puedes alojarla en tu casa sobre un equipo disponible o en Oracle Always Free ARM, con **US$0 de cargos de hosting dentro de las condiciones gratuitas**. Hardware, electricidad, conexión y un dominio comprado tienen costos externos. El perfil mínimo recupera pods; una sola máquina conserva puntos únicos de fallo.

**Estado: implementación inicial funcional.** API, agente, frontend, contratos, Terraform, Kubernetes, CI y comunidad están incorporados. El laboratorio local amd64 pasó simulación, idempotencia, borrado real y recuperación. Las rutas públicas están configuradas y documentadas; requieren cuentas reales y validación. [Evidencia y límites](docs/validation/local-2026-10-04.md).

Repositorio público: [ManuelPerilla/hydra](https://github.com/ManuelPerilla/hydra).

## Arranca Hydra con Docker

Necesitas Docker ejecutándose con contenedores Linux, k3d y kubectl. Reserva 6 GB de RAM para Docker y deja libres los puertos locales 8080 y 6550. No necesitas cuenta cloud, OAuth ni credenciales de X.

Clona el repositorio en PowerShell:

```powershell
git clone https://github.com/ManuelPerilla/hydra.git
cd hydra
```

Desde su raíz, arranca el laboratorio:

```powershell
./scripts/bootstrap.ps1
```

En Linux/macOS:

```sh
bash scripts/bootstrap.sh
```

Abre **http://localhost:8080/es**. El bootstrap genera secretos fuera de Git, construye las tres imágenes, crea o reutiliza el clúster `hydra`, aplica los manifiestos y espera a los componentes. No instala las herramientas ni descarga un repositorio por ti.

**Objetivo: menos de cinco minutos con las herramientas e imágenes listas.** Para reutilizar imágenes locales construidas: `./scripts/bootstrap.ps1 -SkipBuild` o `bash scripts/bootstrap.sh --skip-build`. La primera compilación descarga dependencias y puede tardar bastante más.

Elige un pod de `chaos-demo` y ejecuta **Simulación**. Después puedes seleccionar **Eliminar un pod** y confirmar **INJECT CHAOS**. El operador de desarrollo y la exposición loopback pertenecen al perfil local; los perfiles públicos requieren GitHub OAuth y autorización.

Para desarrollar API e interfaz sin Kubernetes: `./scripts/bootstrap.ps1 -Compose` o `bash scripts/bootstrap.sh --compose`. Compose no incluye el agente Kubernetes y no permite experimentos destructivos.

## Un sistema pequeño, un experimento serio

| Componente | Implementación |
| --- | --- |
| API | ASP.NET Core 10; GitHub OAuth, IDs numéricos autorizados, CSRF, idempotencia y SignalR |
| Agente | Rust, Axum y kube-rs; lease, precondición UID y recuperación del ReplicaSet original |
| Consola | Next.js/React; español, inglés, portugués y árabe RTL; simulación y confirmación |
| Estado | PostgreSQL propio; trabajos durables, auditoría, eventos ordenados y claves compartidas cifradas |
| Runtime | k3s/k3d; probes, RBAC, quotas, NetworkPolicies y HPA con máximo fijo |
| Infraestructura | Terraform local, Cloudflare Tunnel y Oracle ARM con inventario y controles de cuota |
| CI y comunidad | Runners amd64/arm64, manifiestos OCI, SBOM/provenance, formularios, bienvenida y etiquetas |

La consola sigue la dirección visual [Tarde de Té y Lino](docs/design/tea-linen.md): tela clara, tinta sepia, pods como parches bordados y eventos sobre papel. El bastidor toma sus estados de Kubernetes y conserva las huellas de experimentos reales.

Dos APIs leen el log durable con cursores independientes y cada una envía eventos a sus clientes SignalR. La consola reconecta y recupera eventos por cursor. Los límites de retención y buffers son finitos; la capacidad de telemetría masiva aún requiere pruebas de carga.

El agente solo puede eliminar pods en `chaos-demo` y consultar su ReplicaSet. Verifica la cadena Pod → ReplicaSet → Deployment, el UID y las réplicas disponibles antes de borrar. Un trabajo vencido conserva su cupo hasta reconciliarse. Un PDB por sí solo no impide un DELETE directo.

El lema es una metáfora: ReplicaSet restaura el número deseado de réplicas; no crea dos nuevas por cada eliminación.

## Hosting de costo cero

| Ruta | Condiciones |
| --- | --- |
| Casa + Cloudflare | Equipo existente, k3s y Tunnel estable con un dominio disponible |
| Oracle ARM | A1 de 2 OCPU/12 GB; 50 GB boot + 50 GB datos; IP pública y HTTPS gratuito por IP |
| CI/GHCR | Repositorio público, runners estándar amd64/arm64 y paquetes configurados como públicos |

Oracle comparte las cuotas con toda la cuenta: no se asume disponibilidad regional ni continuidad de una VM ociosa. Terraform no sustituye A1 por un shape pagado al faltar capacidad. Inventario previo y revisión de elegibilidad obligatorios. [Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Cloudflare Tunnel estable necesita un dominio; Quick Tunnel queda para demos. La ruta Oracle evita comprarlo usando certificados Let's Encrypt por IP de 160 horas con renovación diaria. [Cloudflare](https://developers.cloudflare.com/tunnel/get-started/), [Let's Encrypt](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).

Las imágenes publicadas tendrán `linux/amd64` y `linux/arm64`; el workflow valida ambas en runners nativos. Consulta el estado real del pipeline en [Actions de Hydra](https://github.com/ManuelPerilla/hydra/actions). La publicación del repositorio no certifica la finalización de los builds ni el acceso anónimo a GHCR. GHCR crea paquetes inicialmente privados: hazlos públicos y comprueba una descarga anónima. [Actions](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Consulta [producción doméstica](docs/runbooks/home-tunnel.md) o [Oracle ARM](docs/runbooks/oracle-arm.md). Antes de exponer Hydra: imágenes por digest, HTTPS, OAuth, IDs permitidos y prueba de restauración.

## Evidencia, no promesas

En el laboratorio local amd64:

- 13 pruebas de API, 13 de Rust y 18 de frontend aprobadas; validación de infraestructura adicional.
- El dry-run conservó el pod y repetir la misma clave produjo el mismo trabajo.
- Un borrado real reemplazó únicamente el UID elegido; el ReplicaSet volvió a dos pods Ready en **2.142 ms** en esa ejecución.
- La consola mostró el resultado mediante SignalR; el dry-run visual también terminó correctamente.
- Terraform validado sin credenciales para los tres entornos; Kubernetes local validado y desplegado.

Ese tiempo es una observación local, no un SLO. No se ha verificado ejecución ARM de todo el stack, despliegue público, OAuth contra GitHub real ni rendimiento de carga. [Registro de validación](docs/validation/local-2026-10-04.md).

El rediseño de la consola añadió siete pruebas del bastidor y pasó una revisión en móvil, árabe RTL y un experimento real adicional. [Evidencia visual](docs/validation/tea-linen-2026-10-04.md).

## Los tweets de la Hydra

Cada eliminación confirmada genera un borrador. El adaptador X existe y está **desactivado por defecto**: su API cobra por uso y no forma parte del núcleo gratuito. No se ha publicado ningún tweet. [X API](https://docs.x.com/x-api/getting-started/pricing).

Comparte alias de laboratorio y duraciones observadas; evita nombres internos sensibles, IPs e identidades de usuarios.

## Construye Hydra con nosotros

Licencia **Apache-2.0**. Aceptamos código, documentación, traducciones, accesibilidad y mediciones ARM. Revisa [CONTRIBUTING](CONTRIBUTING.md), [Código de conducta](CODE_OF_CONDUCT.md), [Gobernanza](GOVERNANCE.md) y [Seguridad](SECURITY.md).

GitHub conserva decisiones y reportes. La [estrategia Discord](docs/community/discord.md) está lista; aún faltan responsables y una invitación oficial. Las campañas son borradores, sin publicaciones automáticas.

- [Arquitectura C4](docs/architecture/c4.md) y [monorepo](docs/architecture/monorepo.md)
- [ADR FinOps](docs/adr/0001-zero-cost-multiarch.md) y [seguridad de implementación](docs/adr/0002-implementation-safety.md)
- [Presupuesto de recursos](docs/finops/resource-budget.md)
- [Campaña día 1](docs/community/launch-day-1.md) y [campañas por componente](docs/community/component-campaigns.md)
- [Detener experimentos](docs/runbooks/emergency-stop.md)

**Corta una cabeza. Conserva la evidencia. Diseña la recuperación.**
