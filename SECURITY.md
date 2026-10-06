# Seguridad

Hydra elimina pods de un laboratorio. Usa únicamente el namespace dedicado `chaos-demo` y nunca credenciales cluster-admin para el agente.

Para reportar una vulnerabilidad, utiliza GitHub Private Vulnerability Reporting cuando el repositorio público exista y esté habilitado. No abras un issue con secretos o detalles explotables. Antes de publicación, el mantenedor debe habilitar el canal privado y registrar un contacto real.

Se mantiene inicialmente la rama main y la versión 0.1. Las correcciones se documentan sin exponer credenciales. Rotar tokens ante filtraciones; una redacción de logs no elimina la exposición previa.

El perfil local solo puede ejecutarse en Development con permiso explícito y origen loopback. Para internet, GitHub OAuth, IDs autorizados, TLS, tokens internos y planes de infraestructura revisados son obligatorios.
