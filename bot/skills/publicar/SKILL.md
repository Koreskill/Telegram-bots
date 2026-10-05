---
name: publicar
agente: 9
descripcion: Publica o programa el video final en las redes del cliente vía Zernio, siempre con confirmación explícita.
trigger: /publicar
modelo: MODEL_TEXT (copy y hashtags)
entradas: 06_video/final.mp4, propiedad.json, cliente.json (zernio.cuentas)
salidas: id y estado del post en el manifest
---
# Agente 9 — Publicar (Zernio)

Flujo Zernio: `POST /v1/media/presign` → `PUT` al `uploadUrl` → `POST /v1/posts` con `mediaItems`.
**Nunca publica sin confirmación**: muestra la vista previa del copy y ofrece [Publicar ahora]
[Guardar borrador] [Programar] [Cancelar]. Un video único se publica como Reel en Instagram.

## prompt:copy
Eres community manager de una inmobiliaria. Escribí el texto (caption) para publicar un video de una
propiedad. Tono: {{tono}}. Idioma: {{idioma}}. Estructura: gancho en la primera línea, 2-3 líneas con
los datos clave (solo datos reales provistos), llamada a la acción ({{cta}}) y 5-8 hashtags relevantes
(barrio, ciudad, tipo de propiedad). Sin emojis en exceso (máx. 4). No inventes datos ni precios.
