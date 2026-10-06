# Hydra Chaos Agent

Worker Rust/Axum para experimentos Kubernetes de Hydra. Consume un solo trabajo
a la vez; la cola y las leases residen en la API, no en la memoria del agente.
Usa Tokio con un solo hilo y un máximo de 100 pods observados por petición.

## Configuración

| Variable | Valor predeterminado | Uso |
| --- | --- | --- |
| `HYDRA_API_URL` | `http://api:8080` | API interna, sin credenciales en la URL |
| `HYDRA_AGENT_TOKEN` | obligatorio | Bearer compartido, mínimo 32 bytes |
| `HYDRA_AGENT_ID` | `hydra-agent` | Identidad de la lease |
| `HYDRA_NAMESPACE` | `chaos-demo` | Único namespace permitido, incluso si se cambia el entorno |
| `HYDRA_MIN_READY` | `2` | Réplicas Ready mínimas antes del borrado, rango 2–10 |
| `HYDRA_RECOVERY_TIMEOUT_SECONDS` | `120` | Ventana de recuperación, rango 10–150 |
| `HYDRA_X_ENABLED` | `false` | Activa la extensión opcional de pago |

El ServiceAccount necesita `get/list/watch/delete` sobre `pods` y únicamente
`get` sobre `apps/replicasets`, todo mediante Role del namespace `chaos-demo`.
El proceso escucha en `8081`; `/health/live`, `/health/ready` y `/metrics` son
internos al clúster. Readiness requiere una sincronización exitosa con
Kubernetes y la API en los últimos 20 segundos.

## Garantías del experimento

1. El Pod debe llevar `hydra.io/chaos=enabled` y pertenecer a un ReplicaSet
   cuyo controlador es un Deployment. Se comprueban nombres, namespaces y UIDs.
2. Se espera un presupuesto de réplicas Ready del mismo ReplicaSet por hasta
   20 segundos; el Pod elegido también debe estar Ready.
3. El objetivo es el UID original. Kubernetes recibe una precondición UID;
   una recreación con el mismo nombre jamás se convierte en otro objetivo.
4. `dryRun` valida las condiciones y no llama a DELETE. No publica en X.
5. El evento `deleted` requiere comprobar ausencia del UID mediante GET,
   incluso si el Pod desapareció de la selección por etiquetas.
6. La recuperación requiere ausencia del UID original y restauración de la
   cantidad inicial de réplicas Ready del ReplicaSet verificado. Se actualiza
   el heartbeat de manera síncrona antes del reporte final.
7. Si el Pod ya no existe al recibir un trabajo sin contexto previo del
   controlador, se registra la ausencia y se falla con una explicación. No se
   elige otra víctima ni se inventa una recuperación. La reserva de seguridad
   de la API puede requerir la intervención descrita en el runbook.

La lease se renueva cada diez segundos. Si falla una renovación se impide
cualquier nuevo borrado; tras un DELETE ya aceptado se sigue observando el
resultado. Los reportes se reintentan de forma acotada con el mismo payload,
sin repetir la mutación de Kubernetes.

## Extensión X

Cada destrucción confirmada conserva un borrador en la auditoría de Hydra.
La publicación automática está apagada para conservar el costo cero. Para
activarla se necesitan `HYDRA_X_CONSUMER_KEY`, `HYDRA_X_CONSUMER_SECRET`,
`HYDRA_X_ACCESS_TOKEN` y `HYDRA_X_ACCESS_SECRET`, con permisos de escritura.
La extensión firma POST `/2/tweets` mediante OAuth 1.0a y publica tras una
recuperación comprobada. Hace un solo intento: reintentar una respuesta incierta
podría duplicar un post facturable. Un error de X no invalida el experimento.
Las credenciales nunca aparecen en logs ni implementan `Debug`.

## Verificación y contenedor

```sh
cargo fmt --all --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
docker build -t hydra-agent:local .
docker buildx build --platform linux/amd64,linux/arm64 -t hydra-agent:multi .
```

El toolchain está fijado en `rust-toolchain.toml` y las dependencias resueltas en
`Cargo.lock`. Cada plataforma se compila con su builder correspondiente. La
imagen final se ejecuta con UID/GID `10001` y admite filesystem de solo lectura.
Las pruebas cubren namespaces prohibidos, ownership, precondición UID,
simulación sin mutación, presupuesto Ready, lease expirada, reejecución segura,
reutilización del nombre y una firma OAuth contra el vector publicado en RFC 5849.
