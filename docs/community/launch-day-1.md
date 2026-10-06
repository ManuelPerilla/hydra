# Campaña de lanzamiento de Hydra día 1

Estado: **borradores para revisión y publicación manual**. No se ha publicado contenido, creado un repositorio remoto ni abierto Discord. El día 1 presenta un laboratorio local operativo.

Evidencia inicial: simulación e idempotencia verificadas; una prueba local **amd64** eliminó un pod por UID y observó su reemplazo en **2.142 ms**, según el agente. La interfaz ofrece cuatro idiomas. Se verificaron inicialmente 13 pruebas de API, 13 de Rust, 11 de frontend y 4 de infraestructura. La duración corresponde a una ejecución y no constituye un promedio, SLO o resultado ARM.

Los borradores completos para API, agente, frontend, infraestructura/FinOps y comunidad/CI están en [campaña por componente](component-campaigns.md). La apertura de Discord seguirá su [estrategia de comunidad](discord.md).

## LinkedIn

**Kubernetes por $0 al mes: construí el primer laboratorio de Hydra y ya puedo demostrar la recuperación de un pod**

Ese es el reto con el que nace Hydra, una plataforma Open Source de Chaos Engineering. Hoy el laboratorio local ya funciona.

“Corta una cabeza y dos más tomarán su lugar”.

La primera evidencia: simulación verificada, reintento idempotente y una eliminación real por UID. En una prueba amd64, el agente observó el reemplazo del pod en 2.142 ms. Es una medición de esa ejecución, con ese equipo y ese clúster.

El presupuesto forma parte de la arquitectura desde el primer día:

→ Laboratorio local con Docker y k3s, ya operativo.
→ Perfil Oracle Always Free ARM sujeto a cuotas y disponibilidad.
→ Alternativa en casa con equipo existente, Cloudflare Tunnel y un dominio disponible.
→ ASP.NET Core, un agente en Rust y una interfaz Next.js con cuatro idiomas.
→ Contenedores y CI para amd64 y arm64.
→ HPA acotado, permisos mínimos y ningún servicio de pago obligatorio.

La disponibilidad exige decir qué fallo podemos tolerar. Ya observamos recuperación de un pod. Una sola máquina, PostgreSQL y el control plane conservan puntos de fallo. El equipo, la electricidad o un dominio pueden tener costo; las cuotas y los recursos de la cuenta determinan si un despliegue cloud mantiene cargos de infraestructura en cero.

Hoy comparto el código, el laboratorio reproducible, el monorepo y los ADR. La verificación inicial suma 41 pruebas. El siguiente paso es ampliar las mediciones y validar ARM con la misma transparencia.

Busco colaboradores en Rust, .NET, React, Kubernetes, ARM, documentación y accesibilidad.

¿Qué fallo te gustaría que Hydra aprendiera a provocar después?

#OpenSource #Kubernetes #ChaosEngineering #FinOps #BuildInPublic

## Uso de la campaña

La idea “alta disponibilidad en Kubernetes por $0 al mes” guía el proyecto. Este lanzamiento describe la recuperación de pods demostrada en el laboratorio local. La disponibilidad ante la pérdida del host, las mediciones ARM y el despliegue cloud requieren evidencia adicional; no prometer disponibilidad cloud ni una factura cero universal.

Antes de publicar: añadir únicamente el enlace real del repositorio cuando exista, revisar condiciones de gratuidad e invitar a una primera contribución concreta. No insertar estrellas, descargas, métricas, screenshots de producto o enlaces de Discord ficticios.

## Resumen por componente

Los textos completos de LinkedIn, Reddit y X para cada componente están en [component-campaigns.md](component-campaigns.md). La tabla siguiente conserva ideas para publicaciones posteriores; sus placeholders se rellenan con nuevos eventos reales.

| Componente | LinkedIn: impacto y ahorro | Reddit: reto técnico | Tweet de muerte de pod, tras observar el evento |
| --- | --- | --- | --- |
| Infraestructura | Diseñar k3s con presupuesto de $0 obliga a limitar recursos y declarar los puntos de fallo. | ¿Cómo validarías la cuota de toda una cuenta antes de aplicar Terraform para A1? | Cayó una cabeza: {alias_pod}. El laboratorio volvió a {ready} réplicas Ready. #ChaosEngineering |
| API ASP.NET Core | Dos APIs necesitan compartir eventos y sesiones para que la redundancia sea útil, sin broker gestionado obligatorio. | ¿Cómo probarías que un evento confirmado llega a clientes de ambas réplicas SignalR, incluso tras reconectar? | Experimento {id_publico}: destrucción confirmada y registrada. Sigue la recuperación en Hydra. |
| Agente Rust | Un agente con permisos de namespace reduce el radio del fallo y evita consumir recursos de más. | ¿Cómo harías un borrado idempotente por UID que nunca seleccione una segunda víctima al reintentar? | Tijeretazo confirmado: {alias_pod}. kube-rs observa la recuperación; tiempo aún pendiente. |
| Frontend Next.js | Una interfaz internacionalizada muestra evidencia de fallos con hosting dentro del mismo clúster. | ¿Cómo manejarías replay, duplicados y cursor caducado sin congelar el navegador? | Una cabeza cayó. Hydra mostró eliminación y recuperación observada en {duracion_medida}. |
| Comunidad y CI | Contribuciones reproducibles con documentación local y verificaciones públicas, sin bots de pago obligatorios. | ¿Qué entorno mínimo y criterios de aceptación hacen útil una primera issue? | Eliminación por UID observada. El experimento {id_publico} ya tiene evidencia reproducible para revisar. #OpenSource |

Los tweets de la tabla son plantillas futuras: solo se completan con eventos reales, alias públicos y mediciones observadas. La simulación conserva su etiqueta y no se convierte en un tweet de destrucción. Una destrucción aquí es la eliminación de un pod de laboratorio; el host sigue ejecutándose.

La API X es una extensión opcional de pago; estos textos pueden generarse y publicarse manualmente sin convertirla en dependencia del despliegue gratuito. [Precios X](https://docs.x.com/x-api/getting-started/pricing)

## Invitación a contribuir

Prioridades del día 1: reproducir el laboratorio, revisar los ADR, ampliar las pruebas de reintentos y leases, validar ARM y mejorar traducciones y accesibilidad. Cuando existan issues públicas, enlazar las reales y etiquetarlas como `good first issue` o `help wanted` según su alcance. Discord se abrirá con normas, moderadores y un canal de reportes definido; GitHub conservará las decisiones técnicas.
