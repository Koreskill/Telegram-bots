---
name: video
agente: 6
descripcion: Renderiza el video final (video real + subtítulos premium + motion graphics + inserts + voz/música) con Remotion.
trigger: /video [estilo]  ·  botón "Aprobar plan y generar video"
modelo: (ninguno; render con Remotion)
entradas: edit-plan.json, estilo.json (plantilla), cliente.json, imágenes extendidas, voz, música
salidas: 06_video/borrador.mp4 (540×960), 06_video/final.mp4 (1080×1920), thumbnail.jpg
---
# Agente 6 — Generador de video

Remotion (`my-video/`, composición `Edicion`) recibe como props el plan, el estilo y la marca del
cliente: **nada del diseño está fijo en el código**, todo sale del `estilo.json`.
Primero un **borrador** a media resolución para aprobar; luego el render final H.264 yuv420p BT.709,
AAC 192k, +faststart. Un render a la vez; timeout de 30 min.
