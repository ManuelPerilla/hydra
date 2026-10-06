# ADR 0002 Implementación inicial de eventos y seguridad

Estado: implementado en la versión local inicial. Fecha: 4 de octubre de 2026.

API y agente comparten contratos REST camelCase. PostgreSQL conserva trabajos y eventos; un lock transaccional serializa publicación. Cada API tiene cursor independiente y SignalR solo transmite a conexiones autorizadas. Las claves DataProtection compartidas se cifran con una key32bytes generada fuera de Git.

El operador local requiere Development y permiso explícito. Los perfiles públicos usan GitHub OAuth, IDs permitidos, CSRF y origen canónico HTTPS. El bootstrap local publica únicamente en loopback. La API Kubernetes y rutas internas del agente no aparecen en el ingress.

Se amplía el Role del ADR inicial con `get` de `apps/replicasets` dentro de `chaos-demo`: un Pod pertenece al ReplicaSet y el agente debe verificar que este pertenece a un Deployment. No se añaden permisos para modificar controladores, secretos, nodos o exec.

El comando fija UID y el DELETE usa su precondición. La eliminación se confirma observando desaparición, incluso si cambian etiquetas. La recuperación se atribuye al ReplicaSet original; otro workload sano no la prueba. Heartbeat antes del reporte recovered garantiza una observación fresca. Un lease vencido conserva el único cupo y el UID; si se pierde contexto del controlador tras reinicio, se registra incertidumbre y no se inventa recuperación.

Los limits iniciales se elevan a API384Mi, web256Mi y agente96Mi para verificar el runtime sin OOM. No son mediciones de RSS. Las optimizaciones posteriores se basarán en pruebas, dentro de la cuota de la VM. X está desactivado; el adaptador de pago no afecta el resultado del experimento.
