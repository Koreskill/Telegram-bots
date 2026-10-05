---
name: imagenes
agente: 2
descripcion: Descarga en máxima resolución las imágenes y el video de la propiedad, filtra basura y deduplica.
trigger: /imagenes  ·  botón "Continuar" tras /capturar
modelo: (ninguno)
entradas: 01_datos/propiedad.json
salidas: 02_media/originales/img_###.jpg, 02_media/originales/indice.json, video descargado (si hay mp4 directo)
---
# Agente 2 — Descargar medios

**Qué hace**
1. Descarga las URLs de `propiedad.imagenes` (concurrencia 4, 3 reintentos con backoff, tope 25 MB).
2. Valida con sharp el formato real (no confía en la extensión) y convierte webp/avif/png a JPG.
3. Descarta íconos, logos, banners y sprites (lado mayor < 800 px, proporción extrema, archivo liviano).
4. Deduplica con hash perceptual (dHash, distancia de Hamming ≤ 4): conserva la de mayor resolución.
5. Guarda `img_001.jpg…` en el orden de la página + `indice.json` con ancho, alto, orientación y origen.
6. Video: si hay un mp4 directo lo descarga a `02_media/`. YouTube/Vimeo solo con yt-dlp y solo si
   `cliente.json → permite_descargar_video_embed` es `true`.
