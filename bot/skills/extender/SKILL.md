---
name: extender
agente: 4
descripcion: Genera la versión 9:16 de cada foto con un modelo de imagen y conserva intactos los píxeles reales.
trigger: /extender  ·  botón "Aprobar prompts y extender"
modelo: MODEL_IMAGE
entradas: 02_media/originales/*.jpg + 03_prompts/*.json
salidas: 04_extendidas/img_###.png (1080×1920), estado de aprobación por imagen en el manifest
---
# Agente 4 — Extender imágenes

1. El modelo genera una versión 9:16 a partir de la foto + prompt (OpenRouter, `image_config.aspect_ratio`).
2. **Paste-back:** la foto original (escalada al ancho final) se pega sobre el centro del resultado con
   bordes difuminados. Los píxeles reales nunca los decide la IA.
3. Se normaliza a exactamente 1080×1920 y se verifica que el centro coincida con la original.
4. Si la IA falla dos veces: fallback determinista (fondo desenfocado + original centrada).
5. Cada imagen se aprueba una por una desde Telegram: [Regenerar] [Usar blur] [Aprobar].
6. Tope de gasto por proyecto y por día: el agente se detiene antes de excederlo.

## prompt:refuerzo
IMPORTANT: your previous result altered the original photo. Extend the canvas only above and below.
The central photo must stay pixel-identical: same objects, furniture, walls, windows and people.
Only generate seamless continuation of the surroundings (sky/ceiling above, floor/ground below).
