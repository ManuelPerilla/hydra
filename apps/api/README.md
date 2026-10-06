# Hydra API

ASP.NET Core 10, PostgreSQL 17+, GitHub OAuth y SignalR. El servicio no elimina pods:
autoriza un UID y persiste el trabajo antes de que el agente lo reclame.

## Configuración

| Variable | Uso |
| --- | --- |
| `ConnectionStrings__Hydra` | Conexión Npgsql a PostgreSQL propio, con volumen persistente |
| `Hydra__AgentToken` | Secreto aleatorio compartido, mínimo 32 caracteres |
| `Hydra__DataProtectionKey` | 32 bytes aleatorios codificados en base64; igual en todas las réplicas |
| `Hydra__AuthMode` | `github` en producción; `local` solo en Development |
| `Hydra__AllowLocalAuth` | `true` para autorizar explícitamente el modo local |
| `Hydra__GitHubClientId` / `Hydra__GitHubClientSecret` | Aplicación OAuth GitHub, callback `/auth/github/callback` |
| `Hydra__AllowedGitHubIds` | IDs numéricos de operadores separados por comas; un login no concede permiso |
| `Hydra__PublicOrigin` | Origen HTTPS canónico sin path, por ejemplo `https://hydra.example.com` |
| `Hydra__TrustedProxyNetworks` | CIDR de proxies autorizados; por ejemplo `10.42.0.0/16` para ingress k3s |

Las cookies de sesión y CSRF usan el key ring compartido en PostgreSQL, cifrado con
AES-256-GCM mediante la clave de bootstrap. Guarda esa clave en Secrets y en el
backup cifrado. Cambiarla sin un proceso de recifrado invalida claves antiguas y
sesiones. No expongas modo local a Internet: convierte cada conexión en operador.

El ingress público solo enruta `/api`, `/auth` y `/hubs/telemetry`, nunca `/internal`.
El agent token no debe aparecer en el navegador. PostgreSQL debe ser privado.

## Desarrollo y verificación

Con SDK .NET 10:

```sh
dotnet test Hydra.sln -c Release
dotnet run --project src/Hydra.Api
```

Para ejecutar también la integración PostgreSQL, configura `HYDRA_TEST_POSTGRES`
con una base de pruebas desechable cuyo usuario pueda crear schemas. La prueba
crea un schema aleatorio y lo elimina al terminar; no toca las tablas de otros
schemas. Sin esa variable la integración se registra como omitida, no aprobada.

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t hydra-api:dev .
```

El build publica ambas arquitecturas mediante el SDK del host de build. La imagen
de runtime se selecciona para el destino, usa UID no root y no necesita volumen de
claves local. No se afirma que un build ARM emulado equivalga a un benchmark ARM.

## Garantías y límites

- Un índice único y un lock transaccional protegen el único slot destructivo.
  Un lease vencido conserva ese slot y su UID; reclamarlo rota el token y no elige
  otra víctima. El lease dura 180 segundos; `running` renueva y no rebaja `deleted`.
- Un fallo conserva el slot hasta una observación saludable posterior. `recovered`
  exige snapshot reciente, al menos dos pods Ready y ausencia del UID eliminado.
- La clave idempotente se vincula a operador y contenido; un conflicto devuelve
  409. Se conserva durante la retención de auditoría, siete días. Después de esa
  retención un cliente no debe reutilizar una clave antigua.
- La outbox y el log se publican en la misma transacción y bajo el mismo lock;
  asignar secuencia y commit es una operación serializada. Cada API tiene cursor
  propio para transmitir todos los eventos a sus clientes SignalR. Los clientes
  deduplican y usan REST para avanzar su cursor durable.
- Eventos: máximo 20.000 y una hora. Auditoría: siete días y 5.000 experimentos;
  al alcanzar el tope se rechazan nuevas acciones hasta recuperar capacidad. Una
  purga nunca elimina trabajo activo. Cada snapshot acepta hasta 100 pods.
- SignalR usa WebSockets, mensajes entrantes de 4 KiB, buffers de 64 KiB y timeout
  de publicación de cinco segundos. En modo GitHub valida el Origin del WebSocket
  contra `Hydra__PublicOrigin`. No se publica una cifra de conexiones o RSS
  soportada sin medirla en el entorno final.
- Si PostgreSQL no está disponible, las acciones fallan antes de autorizar trabajo.
  `/health/live` es independiente; `/health/ready` verifica almacenamiento.

El log SignalR puede entregar duplicados tras una interrupción. Las fechas son UTC,
los mensajes son informativos y los nombres de estados forman parte del contrato
estable. El contrato está en `contracts/openapi/hydra-v1.yaml` del monorepo.
