# Parada de emergencia

En el laboratorio local, detén primero el agente:

```sh
kubectl --context k3d-hydra -n hydra-system scale deployment/hydra-agent --replicas=0
```

Esto detiene nuevas acciones del worker. La API conserva el trabajo y su UID; no autorices otro objetivo hasta revisar si la acción anterior fue aplicada y si volvió la readiness. Un lease expirado no permite seleccionar otra víctima.

Para producción, usa el contexto autorizado correspondiente y retira temporalmente a los operadores si necesitas bloquear solicitudes. Nunca borres la base o el laboratorio como reacción a un resultado incierto. Conserva eventos, revisa pods y realiza la reconciliación antes de reactivar el agente.
