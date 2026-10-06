# Presupuesto de recursos implementado

Este presupuesto corresponde a los workloads de Hydra, no al consumo completo del host. Las mediciones se publican en [validación local](../validation/local-2026-10-04.md).

| Workload | Réplicas iniciales / máximo | CPU request / limit por pod | RAM request / limit por pod |
| --- | --- | --- | --- |
| API | 2 / 3 | 100m / 500m | 128Mi / 384Mi |
| Web | 2 / 2 | 50m / 300m | 64Mi / 256Mi |
| Agente | 1 / 1 | 25m / 250m | 32Mi / 96Mi |
| PostgreSQL | 1 / 1 | 100m / 500m | 256Mi / 512Mi |
| Laboratorio | 2 / 3 | 50m / 200m | 32Mi / 64Mi |
| cloudflared, solo casa | 2 / 2 | 50m / 200m | 64Mi / 128Mi |
| ACME, solo Oracle | 1 / 1 | 10m / 100m | 16Mi / 64Mi |

Stack común: 736Mi requests y 2.016Mi limits iniciales; con API/laboratorio al máximo, 896Mi requests y 2.464Mi limits. Añade 128Mi/256Mi para los conectores domésticos o 16Mi/64Mi para ACME Oracle.

SO, Docker en desarrollo, k3s, Traefik, metrics-server y filesystem cache necesitan margen adicional. Los limits CPU suman más que dos cores: son techos compartidos y puede existir throttling. Requests reducidos permiten el laboratorio mínimo; medir saturación antes de aumentar concurrencia.

Oracle reserva 2 OCPU, 12 GB, boot50 GB y datos50 GB. PostgreSQL solicita un PVC2Gi; el resto del volumen de datos conserva estado k3s, imágenes y margen operativo. No hay Cluster Autoscaler ni creación automática de VMs.

PostgreSQL limita conexiones a 40; cada API tiene pool máximo12. La auditoría conserva siete días con tope de5.000 trabajos; eventos una hora con tope de20.000. Un sistema sin capacidad durable rechaza nuevas autorizaciones.

La muestra local del agente fue 4Mi de working set. Mantener el limit96Mi aporta margen; esa muestra no garantiza consumo bajo carga. Las pruebas de carga y ARM siguen pendientes.
