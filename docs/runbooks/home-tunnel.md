# Producción doméstica con Cloudflare Tunnel

Usa k3s en un equipo existente y un dominio disponible en Cloudflare. El plan gratuito cubre Tunnel; compra del dominio, equipo, electricidad y conexión son costos externos. Quick Tunnel queda para demos.

En `infra/terraform/environments/home-tunnel`, completa la cuenta, zona y hostname. Exporta `CLOUDFLARE_API_TOKEN` con permisos de Tunnel y DNS; no guardes el token en Git. Ejecuta init/plan y revisa antes del apply.

El módulo crea Tunnel, CNAME y ruta hacia el ingress. Guarda el output sensible `tunnel_token` en un archivo protegido fuera de Git y crea el secret `hydra-tunnel` con key `TUNNEL_TOKEN` desde ese archivo. Aplica overlay `home-tunnel` solo con imágenes de release y secretos OAuth completos. Nunca expongas overlay `local`, que concede operador de desarrollo.

Configura `Hydra__PublicOrigin` al hostname HTTPS y registra callback `https://TU_HOST/auth/github/callback`. Haz públicos los tres paquetes GHCR y comprueba su descarga anónima antes de desplegar sin imagePullSecrets. Verifica WebSockets, reconexión, autorización y un dry-run antes del primer borrado. Dos conectores no protegen frente a la pérdida del host, energía o ISP.
