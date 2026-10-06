# Hydra: campaña por componente

Estado: **borradores para revisión y publicación manual**. Este documento no autoriza publicaciones ni crea cuentas, repositorios o un servidor Discord. Los enlaces del repositorio, las issues y la comunidad se añadirán cuando existan y se hayan verificado.

Estos textos acompañan el [lanzamiento del día 1](launch-day-1.md). Se pueden adaptar a cada plataforma manteniendo la evidencia y los límites de esta campaña.

## Evidencia disponible

- El laboratorio local ejecuta la API, el agente, la interfaz y PostgreSQL con Kubernetes.
- Se verificaron simulación e idempotencia. En una prueba local **amd64**, se eliminó un pod por UID y se observó un UID de reemplazo; el tiempo reportado por el agente fue **2.142 ms**.
- Ese tiempo describe una ejecución. No constituye un promedio, percentil, SLO, benchmark comparativo ni garantía para otros equipos.
- La interfaz ofrece español, inglés, portugués y árabe con dirección RTL.
- La verificación inicial comprende **13 pruebas de API, 13 de Rust, 11 de frontend y 4 de infraestructura**. Los totales se actualizarán con nuevas ejecuciones verificadas.
- El diseño contempla amd64 y arm64. La evidencia de este lanzamiento corresponde al laboratorio amd64; no atribuir a ARM resultados aún no medidos.
- El presupuesto base excluye servicios comerciales obligatorios. El equipo doméstico tiene costos de hardware y electricidad. Oracle y Cloudflare requieren respetar cuotas, disponibilidad y condiciones; no existe una garantía universal de factura cero.
- Las réplicas del laboratorio recuperan pods. Una sola máquina, la base de datos y el control plane conservan puntos de fallo.

Los tweets de eliminación solo acompañan eventos reales. La simulación se identifica expresamente y no produce un tweet de destrucción. Un pod eliminado no equivale a un servidor físico destruido. Usar alias públicos y omitir UIDs completos, IPs privadas, tokens y nombres sensibles. La publicación automática en X es opcional; el modo base prepara borradores que se pueden copiar.

## API: ASP.NET Core, OAuth y SignalR

### LinkedIn

Una solicitud de caos parece sencilla: “elimina este pod”. Lo difícil empieza cuando la respuesta se pierde y el usuario vuelve a pulsar el botón.

En Hydra, la API conserva el comando y su clave de idempotencia en PostgreSQL. Una repetición puede recuperar el mismo experimento. El comando incluye el UID del pod: el nombre por sí solo no identifica una víctima segura.

El plano de control combina ASP.NET Core, GitHub OAuth, protección CSRF y SignalR. Los eventos persistidos permiten recuperar el flujo tras reconectar; cada réplica de la API sirve a sus propias conexiones.

La decisión FinOps fue ejecutar la persistencia en infraestructura propia y evitar un broker gestionado obligatorio. Eso mantiene pequeño el presupuesto de servicios y nos deja una responsabilidad concreta: operar y respaldar PostgreSQL.

Hoy tenemos 13 pruebas iniciales de API y un flujo local que ejecuta experimentos. El siguiente reto es ampliar la evidencia bajo pérdida de respuestas, reconexiones y fallos del almacenamiento.

¿Qué prueba de idempotencia consideras imprescindible antes de autorizar una eliminación?

#DotNet #DistributedSystems #ChaosEngineering #FinOps #OpenSource

### Reddit

**Título:** API de Chaos Engineering: ¿cómo evitas una segunda víctima cuando se pierde la respuesta HTTP?

Estoy construyendo Hydra. El cliente envía namespace, nombre, UID del pod y una clave de idempotencia. La API almacena comando, auditoría y eventos en PostgreSQL, y el agente reclama el trabajo mediante un lease.

Ya verificamos simulación e idempotencia en el laboratorio local. También observamos un reemplazo real por UID en una ejecución amd64. El frontend reconstruye eventos con un cursor REST cuando SignalR se reconecta.

Me interesa revisar los casos difíciles: respuesta perdida después del commit, cliente que reintenta al cambiar el pod, lease vencido y cliente conectado a otra réplica. ¿Qué fallos inyectarías para comprobar que se conserva la identidad del experimento y el destino autorizado?

Puedo compartir el contrato y las pruebas cuando el repositorio público esté disponible. El enlace se añadirá entonces.

### Tweet tras una eliminación real

Hydra registró una eliminación por UID en el laboratorio. La API conserva comando, auditoría y eventos; reintentar usa la misma solicitud. Una prueba local amd64 observó reemplazo en 2,142 s. Una ejecución, sin promesa de SLO. #ChaosEngineering

## Agente: Rust, Axum y kube-rs

### LinkedIn

El componente con permiso para provocar fallos debería tener un trabajo pequeño y límites fáciles de revisar.

El agente de Hydra reclama un experimento, valida su ámbito y solicita a Kubernetes eliminar el UID autorizado. Después observa el laboratorio y reporta el resultado. Su RBAC queda limitado al namespace de pruebas; el plano de control permanece fuera de ese alcance.

Elegimos Rust, Axum y kube-rs para construir un agente compacto. El consumo de memoria será una medición del despliegue: todavía no publicamos cifras de RAM ni comparaciones sin pruebas.

La primera ejecución real amd64 observó el reemplazo del pod en 2.142 ms según el agente. La simulación también funciona, y contamos con 13 pruebas iniciales de Rust.

Para FinOps, el objetivo es que el agente conviva con el resto del sistema en recursos gratuitos disponibles, sin un servicio de caos de pago obligatorio.

Ahora queremos revisar recuperaciones interrumpidas y reintentos del mismo trabajo. Una víctima autorizada debe seguir siendo una sola víctima.

#Rust #Kubernetes #ChaosEngineering #OpenSource #FinOps

### Reddit

**Título:** Rust + kube-rs: borrar por UID y recuperarse de un lease vencido sin escoger otro pod

Hydra ya tiene un agente local que ejecuta simulaciones y eliminaciones controladas. Usamos precondición UID y permisos limitados al laboratorio. Si el nombre vuelve a existir con otro UID, ese reemplazo no debe convertirse en una segunda víctima.

En una prueba amd64, el agente reportó reemplazo en 2.142 ms. Ese dato es de una sola ejecución; nos interesa ampliar la evidencia de corrección ante fallos.

¿Cómo diseñarías las pruebas cuando el proceso cae después de solicitar el borrado pero antes de reportarlo? ¿Qué evidencia persistirías para reanudar la observación con el mismo experimento?

Buscamos revisión de límites RBAC, recuperación de leases y pruebas en ARM con resultados reproducibles.

### Tweet tras una eliminación real

Una cabeza cayó en chaos-demo. Rust + kube-rs eliminaron el UID autorizado y observaron su reemplazo: 2,142 s en una prueba local amd64. El reemplazo no se convierte en otra víctima al reintentar. #Rust #ChaosEngineering

## Frontend: Next.js, React e internacionalización

### LinkedIn

Un botón que dice INJECT CHAOS necesita explicar qué va a ocurrir y qué sabemos después.

La consola de Hydra empieza en simulación. Muestra el pod objetivo, exige confirmar una eliminación y bloquea nuevos experimentos cuando no tiene datos recientes o permisos de operador.

La telemetría combina SignalR y eventos persistidos. Si se pierde el WebSocket, la interfaz consulta el flujo por HTTP. Si vence la retención, avisa de la interrupción y actualiza el historial desde la API.

También ofrecemos español, inglés, portugués y árabe RTL. Las fuentes se sirven desde el propio contenedor y los formatos usan Intl. El frontend puede convivir con los otros componentes en el clúster, sin hosting comercial obligatorio.

Hoy contamos con 11 pruebas iniciales de frontend y revisión visual de escritorio y móvil. La consola presenta evidencia recibida del sistema; una simulación conserva su etiqueta y no se presenta como recuperación medida.

Buscamos revisión de accesibilidad, traducciones y comportamiento ante reconexiones prolongadas.

#React #NextJS #Accessibility #Internationalization #OpenSource

### Reddit

**Título:** Consola React para Chaos Engineering: replay de SignalR, duplicados y retención vencida

En Hydra, el WebSocket entrega eventos en vivo y REST mantiene el cursor persistido. Una secuencia que salta por delante no debe impedir recuperar los eventos anteriores. La ventana visible está acotada para limitar el trabajo del navegador.

La consola bloquea los experimentos sin API o con estado vencido. La simulación es el modo inicial; el borrado usa un diálogo nativo de confirmación. Ya hay cuatro idiomas, incluido árabe RTL, y 11 pruebas iniciales.

El reto que quiero revisar: eventos fuera de orden mientras el usuario cambia de idioma, reconexión a otra réplica y un cursor cuya retención ya venció. ¿Qué invariantes probarías para que la interfaz siga mostrando un historial coherente y controles seguros?

### Tweet tras una eliminación real

INJECT CHAOS → eliminación confirmada → reemplazo observado. La consola Hydra siguió una prueba local amd64 de 2,142 s, con historial real y cuatro idiomas. El siguiente reintento conserva el experimento. #React #ChaosEngineering

## Infraestructura y FinOps: k3s, Terraform y ARM

### LinkedIn

El presupuesto de infraestructura debería ser una restricción visible de la arquitectura.

Hydra ya funciona como laboratorio local sobre Docker y k3s: API, agente, interfaz y persistencia. El diseño permite publicar desde un equipo existente con Cloudflare Tunnel o usar recursos ARM disponibles dentro de Oracle Always Free.

La clave está en acotar: HPA con límites, requests y limits explícitos, permisos por namespace y cero servicios comerciales obligatorios en el perfil base. Terraform debe comprobar cuotas y recursos existentes, y detenerse cuando no se cumplan las condiciones del perfil gratuito.

Una prueba local amd64 eliminó un pod y observó su reemplazo en 2.142 ms. Es evidencia de recuperación de pods en ese entorno. Una sola máquina sigue siendo un punto de fallo y la factura depende de las cuotas, la cuenta y los recursos elegidos.

Nuestro siguiente paso de FinOps es medir uso real y validar el despliegue ARM. Los límites configurados de RAM todavía no son resultados de consumo.

#FinOps #Kubernetes #Terraform #ARM #BuildInPublic

### Reddit

**Título:** k3s con presupuesto de servicios $0: ¿cómo comprobarías cuotas antes de aplicar Terraform?

Hydra tiene un laboratorio local operativo y un perfil de infraestructura que apunta a equipo doméstico existente o Oracle Always Free ARM. Cloudflare Tunnel ofrece una ruta doméstica con un dominio disponible.

Quiero que el plan falle de forma explícita si una selección deja de cumplir el perfil gratuito. Eso implica revisar recursos existentes de toda la cuenta, región, shape, almacenamiento y límites de escalado. Un presupuesto o una alerta no sustituyen esa validación.

La recuperación de un pod ya se observó en una prueba local amd64 de 2.142 ms. No hemos usado esa prueba para afirmar disponibilidad ante la pérdida del host o resultados ARM.

¿Qué condiciones validarías antes de provisionar y qué comprobaciones repetirías tras aplicar? Buscamos casos concretos de deriva de cuotas y configuraciones que parezcan gratuitas hasta que se agregan otros recursos.

### Tweet tras una eliminación real

Kubernetes repuso el pod de laboratorio que Hydra eliminó por UID. Una prueba local amd64: 2,142 s. El perfil evita hosting de pago obligatorio; cuotas, electricidad y puntos de fallo siguen visibles. #FinOps #Kubernetes

## Comunidad y CI: contribuciones verificables

### LinkedIn

Una plataforma de caos necesita que sus colaboradores puedan reproducir tanto el éxito como el fallo.

Hydra empieza con documentación de instalación local, ADR, reglas de contribución y una estrategia de Discord. El registro técnico conserva experimentos, decisiones y límites del diseño.

La verificación inicial suma 41 pruebas: 13 de API, 13 de Rust, 11 de frontend y 4 de infraestructura. Además, ejecutamos una simulación, comprobamos idempotencia y observamos un reemplazo real por UID en un laboratorio amd64.

El diseño de CI contempla contenedores amd64 y arm64 y un repositorio público. Los permisos y credenciales de despliegue deben mantenerse fuera de las contribuciones de forks. La comunidad puede empezar sin bots de pago obligatorios.

Buscamos primeras contribuciones concretas: revisar una traducción, reproducir una prueba ARM, cuestionar una decisión FinOps o mejorar la documentación de recuperación.

El repositorio público y la invitación de Discord se compartirán cuando estén disponibles. Mientras tanto, los borradores de lanzamiento quedan preparados para revisión.

#OpenSource #DevRel #GitHubActions #BuildInPublic #ChaosEngineering

### Reddit

**Título:** Lanzando un proyecto de Chaos Engineering: ¿qué evidencia te hace confiar en una primera contribución?

Hydra ya dispone de un laboratorio local operativo, cuatro idiomas y una verificación inicial de 41 pruebas entre API, Rust, frontend e infraestructura. También comprobamos simulación, idempotencia y reemplazo de un UID real en una ejecución amd64.

Queremos que colaborar sea reproducible con Docker y k3s. Los cambios de documentación, pruebas y traducciones deben tener una entrada tan clara como los cambios del agente. Las decisiones arquitectónicas se conservan como ADR y los reportes de seguridad seguirán un canal privado real cuando se publique el repositorio.

¿Qué debe contener una primera issue para que puedas comenzar sin depender de una conversación privada con el mantenedor? Nos interesan ejemplos de entorno mínimo, criterios de aceptación y pruebas que demuestren el cambio.

Discord tiene una estrategia documentada; el servidor todavía no se ha abierto. No añadiremos invitaciones o estadísticas ficticias.

### Tweet tras una eliminación real

Primera cabeza cortada en Hydra: UID eliminado y reemplazo observado en una prueba local amd64. Simulación, idempotencia y 41 pruebas iniciales acompañan el resultado. Buscamos revisiones y contribuciones reproducibles. #OpenSource

## Preparación de cada publicación

1. Verificar que el texto coincide con el estado de la rama y la evidencia disponible.
2. Sustituir cifras únicamente por mediciones reales con entorno y alcance indicados.
3. Añadir enlaces reales al repositorio y a la issue concreta, cuando existan.
4. Consultar las normas de la comunidad de Reddit elegida y declarar la autoría del proyecto.
5. Revisar accesibilidad, idioma y ausencia de datos sensibles en capturas.
6. Publicar manualmente después de la revisión del mantenedor. Guardar el enlace real del post cuando se haya publicado.
