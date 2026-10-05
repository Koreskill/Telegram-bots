---
name: voz
agente: 5b
descripcion: Genera la voz en off del plan con un modelo de audio de OpenRouter y la normaliza.
trigger: /voz  (opcional; solo si el plan tiene segmentos vo)
modelo: MODEL_TTS
entradas: 05_guion/edit-plan.json (vo)
salidas: 05_guion/voz/vo_###.wav (-16 LUFS), duración real actualizada en el plan
---
# Agente 5b — Voz en off

Un clip por segmento, en streaming PCM16 24 kHz → WAV normalizado a -16 LUFS. La voz se elige en
`cliente.json → voz.voice` (o `TTS_VOICE`). Se puede regenerar cada clip desde Telegram.
Si OpenRouter ofrece un endpoint de TTS dedicado, conviene migrar a él (ver docs/DECISIONES.md).

## prompt:sistema
Eres locutor profesional. Idioma y tono: {{idioma}}, {{tono}}. Ritmo medio, dicción clara, calidez.
{{instrucciones}}
Leé EXACTAMENTE el texto del usuario: sin agregar, omitir ni reformular palabras, sin saludos ni comentarios.
