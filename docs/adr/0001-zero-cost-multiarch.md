# ADR 0001 Arquitectura de costo cero y soporte multi-arquitectura

- Fecha: 4 de octubre de 2026.
- Estado: aceptado para el diseño inicial; implementación y mediciones pendientes.
- Ámbito: hosting, persistencia, telemetría, contenedores y CI/CD.

## Contexto

Hydra debe funcionar sin contratar servicios de pago obligatorios. Las capas gratuitas tienen cuotas, restricciones y riesgo de cambio; una prueba temporal con créditos no constituye una arquitectura gratuita sostenible. La gratuidad requiere controlar toda la cuenta, no únicamente lo que crea este repositorio.

La alta disponibilidad tiene dominios de fallo. El perfil gratuito mínimo puede recuperar pods sin garantizar continuidad ante la pérdida de su VM, su almacenamiento o el control plane. La campaña debe usar esa definición y el estado real del proyecto.

## Decisión

1. **Producción principal Oracle ARM:** una VM `VM.Standard.A1.Flex`, 2 OCPU y 12 GB, Ubuntu ARM y k3s autogestionado. Boot de 50 GB y block volume de datos de 50 GB: 100 GB asignados dentro del máximo gratuito combinado de 200 GB; rendimiento Balanced, sin aumento automático de VPU. El mínimo de un block volume es 50 GB. Validar elegibilidad y cuota restante de cuenta en la región principal antes del plan. Las cuotas actuales documentadas son 1.500 OCPU-h y 9.000 GB-h al mes; no usar las cifras históricas 4 OCPU/24 GB. [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Tamaño de volúmenes](https://docs.oracle.com/en-us/iaas/Content/Block/Tasks/creatingavolume.htm)
2. **Alternativa doméstica:** k3s sobre hardware existente, expuesto mediante Cloudflare Tunnel estable. k3d sobre Docker reproduce k3s para desarrollo. Tener un dominio en Cloudflare es condición de esa ruta; Quick Tunnel sin dominio se limita a demos. [Tunnel](https://developers.cloudflare.com/tunnel/get-started/), [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
3. **Frontend en el mismo clúster:** Next.js y React, con origen común para UI, OAuth, REST y WSS. Evita servicios de frontend o transporte gestionado obligatorios.
4. **Persistencia autogestionada:** un PostgreSQL con almacenamiento persistente. Comandos, auditoría, leases y eventos viven en la misma base. Fan-out de aplicación mediante outbox y log ordenado, cursor por API y replay; no se incorpora otro broker al perfil inicial.
5. **Publicación X optativa:** borrador por destrucción confirmada. El adaptador de API se conserva como extensión, apagado en Zero-Cost, porque publicar no es gratis permanentemente. [X API](https://docs.x.com/x-api/getting-started/pricing)
6. **Multi-arquitectura obligatoria:** todos los contenedores propios y dependencias del runtime deben soportar `linux/amd64` y `linux/arm64`. Un release contiene ambas variantes con el mismo contrato funcional.

## Cómo evitamos comprar un dominio para Oracle

La VM usa IP pública reservada, ingress con TLS y certificados Let's Encrypt para IP. Están disponibles y duran 160 horas. Un cliente ACME compatible renovará automáticamente, validará por HTTP-01 y recargará TLS; se vigilará la expiración. El puerto 80 solo servirá el challenge y redirección a HTTPS. La callback OAuth usa la IP estable y HTTPS. Esta ruta debe pasar una prueba de renovación y login antes de declararse lista para producción. [IP pública reservada](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm), [Let's Encrypt para IP](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [Certbot compatible](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

En la ruta doméstica no se promete adquirir gratis un dominio estable. Hardware, electricidad, ISP y registro de dominio se declaran como costos externos o previamente disponibles. Oracle evita gastos de adquisición de hardware y dominio, sujeto a acceso a su capa gratuita.

## Presupuesto inicial de recursos

Estas cifras son requests/limits propuestos en MiB, no benchmarks. Los límites pueden necesitar ajuste tras medir el runtime.

| Carga | Réplicas | RAM request / limit por pod | Escalado |
| --- | ---: | ---: | --- |
| API y SignalR | 2 | 128 / 256 | HPA 2-3; CPU request 100m |
| Next.js | 2 | 64 / 128 | Fijo |
| Agente Rust | 1 | 32 / 64 | Fijo; un experimento simultáneo |
| PostgreSQL | 1 | 256 / 512 | Fijo; buffers y conexiones acotados |
| Ingress | 1 | 64 / 128 | Fijo |
| Carga de laboratorio | 2 | 32 / 64 | HPA 2-3; CPU request 50m |
| metrics-server | 1 | 64 / 128 | Fijo |
| cloudflared, solo casa | 2 | 64 / 128 | Fijo |

En Oracle, requests de RAM iniciales suman 864 MiB; los limits, 1.728 MiB. Con ambos HPA al máximo, los limits suman 2.048 MiB. Reservar además al menos 1 GiB para SO/control plane, margen de CPU y memoria y memoria de página; Kubernetes no convierte esta suma en una garantía de RSS. El equipo de desarrollo debe disponer de 4-6 GB para Docker. [Requisitos k3s](https://docs.k3s.io/installation/requirements)

Telemetría inicial: buffers acotados por cliente, agregación de métricas, retención de eventos de una hora y auditoría de siete días, con topes por tamaño además de tiempo. Cuando un cursor caduque, la UI recibe snapshot y aviso explícito del intervalo no disponible. Los objetivos de throughput, RSS del agente y número de conexiones se publicarán después de las pruebas en ambas arquitecturas.

## Terraform y controles FinOps

- Módulos independientes para runtime local, Tunnel, Oracle ARM y guardrails; proveedores versionados y lockfile por entorno. Estado local protegido en desarrollo; producción con acceso restringido y copia cifrada, sin credenciales en Git.
- En Oracle, shape permitido A1, región principal, OCPU/RAM y volúmenes dentro de la cuota restante. Preflight consulta uso existente de la cuenta y eligibility; si no hay capacidad o elegibilidad verificable, se detiene sin cambiar a un shape pagado.
- Se validan compute, boot/data, backups, salida de red y cualquier recurso propuesto. Se respeta el máximo de cinco backups de volúmenes y 10 TB mensuales de salida, compartidos por la cuenta. Una precondición Terraform no basta para detectar consumo externo o cambios concurrentes; se combina con cuotas del compartimento y revisión del plan.
- No OKE obligatorio, NAT Gateway, base gestionada de pago, load balancer pagado ni expansión automática de nodos. HPA solo escala pods hasta el máximo declarado; no crea VMs.
- Backups cifrados locales o recursos elegibles ya presupuestados. Un backup en el mismo disco no protege del fallo del host; restauración e independencia de copias se documentan antes de producción.
- El plan rechazará tipos fuera de una allowlist, mostrará recursos y asignaciones, y exigirá revisar la cuota antes del apply. Las alertas de presupuesto no son un bloqueo de gasto.
- Mantener cuenta Always Free sin conversión automática a pago. Si el proveedor modifica las condiciones, el preflight falla y se utiliza la alternativa local; nunca se habilita una compra para continuar.

## CI/CD y ARM

Repositorio público, runners estándar `ubuntu-24.04` y `ubuntu-24.04-arm`; ningún larger runner. Compilación y smoke tests por arquitectura, pruebas de compatibilidad y manifiesto OCI conjunto en GHCR. Las imágenes base y los binarios auxiliares también deben tener ambas variantes. [Runners GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

Fijar versiones/digests, generar SBOM y firmas, controlar retención de cachés/artefactos y publicar solo desde ramas autorizadas. GitHub mantiene gratuitos los runners estándar en repositorios públicos y actualmente el almacenamiento/tráfico de GHCR; no extrapolarlo a repositorios privados o artefactos ilimitados. [Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Packages](https://docs.github.com/en/billing/concepts/product-billing/github-packages)

CI de forks no accede a secretos. El despliegue propone un plan y un digest revisables; el apply se ejecuta desde un flujo autorizado. El perfil inicial permite despliegue manual reproducible. Automatización continua posterior mediante pull desde el clúster o runner dedicado aislado de PR externos, sin abrir la API Kubernetes al público.

## Disponibilidad y seguridad

Dos pods de API/web y de laboratorio proporcionan redundancia de procesos. Un único host, PostgreSQL y el control plane siguen siendo puntos únicos de fallo. K3s HA con etcd necesita tres o más servidores y no pertenece a este perfil gratuito mínimo. [K3s HA](https://docs.k3s.io/datastore/ha-embedded)

El agente solo opera en `chaos-demo`. No destruye `hydra-system`, namespaces del sistema, nodos ni volúmenes. Valida UID, lease y presupuesto inmediatamente antes del borrado y envía una precondición UID en el DELETE Kubernetes. Un lease vencido no libera el cupo para un experimento distinto hasta reconciliar el trabajo anterior; todos los reintentos conservan el mismo UID. La consistencia de la outbox, el fan-out a clientes conectados a distintas réplicas y las cookies OAuth compartidas son condiciones de aceptación, no supuestos de que duplicar pods sea suficiente.

## Alternativas evaluadas

| Alternativa | Resultado |
| --- | --- |
| K3s local + Tunnel | Admitida; requiere recursos domésticos y dominio estable existente |
| Oracle ARM Always Free | Elegida para producción sin compra de dominio/hardware |
| Quick Tunnel permanente | Solo demos; URL temporal y sin garantía de uptime |
| Créditos promocionales | Excluidos como fundamento: caducan |
| Kubernetes gestionado/broker gestionado | Excluidos como dependencia del perfil gratuito |
| Valkey/Redis propio para SignalR | Posible ADR posterior; añade un proceso y otro punto de fallo |
| Frontend externo gratuito | Opcional; no aporta una dependencia necesaria al diseño inicial |

## Consecuencias y aceptación

Avance de implementación: [ADR 0002](0002-implementation-safety.md) y [validación local](../validation/local-2026-10-04.md). El presupuesto anterior es la propuesta inicial; los limits implementados son API384Mi, web256Mi y agente96Mi. La publicación remota, pruebas ARM, HTTPS/OAuth públicos, firmas de release y restauración siguen pendientes. El inventario verifica recursos, pero elegibilidad y egreso requieren revisión explícita de la cuenta; no se detectan cambios de precio automáticamente.

Ventajas: sin servicios de pago obligatorios, portabilidad ARM/x86, costos visibles y laboratorio reproducible. Costos operativos: administrar parches, persistencia, certificados, backups y límites; cuotas gratuitas y capacidad del proveedor no garantizan un SLA. Oracle puede reclamar instancias gratuitas ociosas: la recuperación se basa en backups y redespliegue o en la ruta local, sin generar carga artificial para evitar esa política. [Política Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Antes de v0.1 se verificará:

1. Arranque local en amd64 y arm64, con tiempo registrado y precondiciones publicadas.
2. Publicación de las tres imágenes propias y todas sus variantes OCI.
3. Rechazo de permisos fuera del laboratorio y repetición idempotente del mismo experimento.
4. Eliminación de un pod y vuelta a dos Ready; medición del lapso y pruebas de reconexión/fan-out.
5. Rechazo de planes fuera de cuota, revisión de costos de cuenta y ausencia de servicios obligatorios facturables.
6. Renovación TLS por IP y GitHub OAuth bajo HTTPS en Oracle.
7. Restore de backup y publicación de límites de disponibilidad conocidos.
