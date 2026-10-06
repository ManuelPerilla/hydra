# Tarde de Té y Lino

Hydra explica la recuperación mediante un tapiz: cada pod observado es un parche y cada eliminación confirmada deja una huella. La apariencia tranquila conserva las confirmaciones, los estados de conexión y la evidencia del experimento.

## Materiales y color

| Uso | Color |
| --- | --- |
| Lino de fondo | `#F7F4F0` |
| Tinta sepia | `#4A4238` |
| Hilo matcha | `#A3B899` |
| Terracota | `#D98A7B` |
| Algodón de las tarjetas | `#FCFAF6` |

El algodón es un blanco cálido para respetar la petición de evitar blanco puro. Una textura SVG de baja opacidad dibuja la urdimbre sin descargar imágenes. Las superficies tienen radios de 20–24 px y sombras cálidas; las costuras y cruces sustituyen los acentos luminosos. Los textos pequeños usan variantes más oscuras de matcha y terracota para mantener contraste.

Nunito acompaña títulos y controles; Courier Prime da forma a datos y bitácora. Noto Sans Arabic conserva la lectura árabe y RTL. Las tres fuentes se sirven desde el contenedor y no añaden servicios ni cuotas.

## Bastidor y ejecución

- Cada parche actual corresponde a un UID recibido en `/api/targets`; su disponibilidad procede de ese pod.
- Las costuras son decoración que organiza la vista. No representan una topología de red ni máquinas físicas.
- Una eliminación real puede dejar una huella cuando el UID original ya está ausente de una observación posterior. Se conservan hasta tres huellas recientes.
- Una huella sigue terracota aunque el experimento se recupere: Kubernetes crea otro pod y el original no vuelve a existir.
- «Recuperación registrada» exige un experimento recuperado con una duración medida. El bastidor no atribuye un pod nuevo como reemplazo si la API no proporciona esa relación.
- Una simulación valida el objetivo y conserva el pod; nunca dibuja una muerte.
- La primera carga establece el estado inicial. Solo los nuevos UIDs observados después reciben la animación de puntadas.

El botón terracota se hunde al presionarlo y conserva la confirmación del pod. El modo inicial es simulación. Las solicitudes nuevas requieren estado reciente, al menos dos pods disponibles y ninguno pendiente; una solicitud incierta conserva su clave de idempotencia al reintentarse.

## Accesibilidad

Los estados incluyen texto y no dependen solo del color. La navegación, el selector, los parches y la confirmación funcionan con teclado y tienen foco visible. Los cambios del bastidor se anuncian con una región de estado. Los errores y las respuestas inciertas conservan mensajes propios.

El mapa permite desplazamiento táctil nativo y arrastre del fondo con ratón. Al alcanzar un borde, la tela se estira como máximo 18 px y vuelve en 350 ms. `prefers-reduced-motion` elimina las animaciones y el movimiento decorativo; `prefers-contrast` y colores forzados conservan controles distinguibles. Los nombres de pods usan aislamiento bidireccional en árabe.

No se añade un control de intensidad: el contrato actual ejecuta un único objetivo por experimento. Ese control requeriría primero una capacidad real y sus límites en la API.

[Validación y capturas del laboratorio](../validation/tea-linen-2026-10-04.md).
