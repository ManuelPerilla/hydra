# Hydra Web

Interfaz Next.js con dos áreas separadas: la lección educativa `/es/learn` y la consola avanzada `/es`. La raíz `/` abre la lección.

La lección funciona solo con el servidor web, sin API, Kubernetes, agente ni sesión. Su modelo local y determinista muestra dos réplicas, la desaparición de A, la creación de C y su paso a Ready. El alumno controla cada transición: no hay tiempos de recuperación ficticios ni llamadas a endpoints de experimentos. Puede predecir, volver atrás, reiniciar y repetir.

En la consola avanzada, datos y ejecuciones siempre proceden de Hydra API; sin API los controles están deshabilitados. El dry-run es el modo inicial y una eliminación exige confirmar el pod. Ese dry-run sí necesita el laboratorio real.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://localhost:3000/es`. En desarrollo las rutas `/api`, `/auth` y `/hubs` se redirigen a `HYDRA_API_URL` (por defecto `http://localhost:5000`). En producción, ingress o el gateway de Compose deben enrutar esas rutas directamente hacia la API y permitir WebSockets. La interfaz y la API usan el mismo origen y cookies de sesión; las mutaciones requieren CSRF e idempotencia.

Idiomas: español, inglés, portugués y árabe con RTL. Las fuentes se sirven desde el propio contenedor. No es necesario Vercel ni una API comercial de traducción.

La dirección visual **Tarde de Té y Lino** usa un fondo tejido, tinta sepia, parches bordados y una bitácora sobre papel. Nunito, Courier Prime y Noto Sans Arabic se empaquetan localmente. El bastidor muestra pods actuales y huellas de eliminaciones confirmadas; una simulación no crea una huella ni una recuperación ficticia. [Criterios de diseño](../../docs/design/tea-linen.md).

Las licencias SIL Open Font License de las fuentes se distribuyen en `public/font-licenses/` y se conservan en la imagen de producción.

SignalR utiliza WebSockets sin negociación. Al conectar y reconectar se recuperan los eventos persistidos desde REST. Si no hay WebSocket, la interfaz consulta eventos cada tres segundos y reintenta con espera creciente. La retención agotada borra la ventana local y actualiza el historial y los objetivos. Se muestran como máximo 30 eventos y 12 experimentos recientes.

```sh
pnpm typecheck
pnpm test
pnpm build
docker build -t hydra-web .
```

El Dockerfile usa imágenes Node multi-arquitectura, salida standalone y usuario sin privilegios. `/healthz` comprueba que el servidor web responde; la disponibilidad de la API se informa por separado en la consola.

Las pruebas cubren la frontera de confianza de la API, CSRF/idempotencia, los gaps del cursor de eventos, reconexión, fallback HTTP, limpieza al desmontar y la correspondencia entre los parches y los pods observados. La interfaz no presenta límites de memoria como mediciones de consumo real.

La lección se compone de contenido traducido en `src/i18n/learning.ts`, un reducer puro en `src/lib/learning.ts` y componentes en `src/components/learning/`. No importa los clientes de API o telemetría. Añadir contenido no amplía los tipos de fallos reales.
