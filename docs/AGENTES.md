# Agentes, skills y triggers

Cada agente es un módulo (`bot/src/agents/`) con su **skill** (`bot/skills/<id>/SKILL.md`): un archivo con
metadatos (trigger, modelo, entradas, salidas) y los **prompts** que el agente carga en tiempo de ejecución.
Editar una skill cambia el comportamiento del agente **sin tocar código** (reiniciar el bot para recargarla).

## Ruta completa

```
/capturar <url> → /imagenes → /prompts → /extender → /subir + /guion → (/voz) → /video → /video --final → /publicar
   Agente 1        Agente 2    Agente 3   Agente 4      Agente 5        5b       Agente 6                    Agente 9
```

## Triggers

| Trigger | Agente | Clase | Qué hace |
|---|---|---|---|
| `/capturar <url> [cliente]` · **pegar una URL suelta** | 1 `capturar` | liviano | Crea el proyecto y `propiedad.json` |
| `/todo <url> [cliente]` | 1→2→3 | liviano | Encadena capturar → imágenes → prompts y se **detiene** para que apruebes |
| `/imagenes` | 2 `imagenes` | liviano | Descarga, filtra, deduplica y numera las fotos |
| `/prompts` | 3 `prompts` | liviano | Un prompt de extensión 9:16 por foto (editables con ✏️) |
| `/extender [N…] [--forzar]` | 4 `extender` | **pesado** | Genera 1080×1920 con paste-back; aprobación por imagen |
| *(subir un video como archivo)* · `/subir` | — | — | Guarda el video grabado en el proyecto activo |
| `/guion [--voz] [--forzar]` | 5 `guion` | **pesado** | Transcribe, analiza escenas y arma el plan de edición |
| `/voz` | 5b `voz` | **pesado** | Voz en off de los segmentos `vo` del plan |
| `/estilos [--forzar]` | 6a `estilo` | **pesado** | Analiza videos de `plantilla/estilos/` → `estilo.json` |
| `/video [estilo] [--final]` | 6 `video` | **pesado** | Borrador 540×960 → aprobar → final 1080×1920 |
| `/publicar` | 9 `publicar` | liviano | Vista previa del copy; **publica solo con confirmación** |
| `/nuevocliente <nombre>` · `/cliente` · `/proyecto` · `/estado` · `/cancelar` · `/ayuda` | — | — | Gestión |

Trabajos **pesados**: de a uno a la vez. **Livianos**: hasta 3 en paralelo. `/cancelar` detiene lo que corre
(mata ffmpeg/Chromium/whisper) y limpia la respuesta pendiente.

## Botones (callback_data ≤ 64 bytes)

`next:<agente>` siguiente paso · `ep:img_###` editar prompt · `rg:` / `bl:` / `ok:img_###` regenerar / blur / aprobar ·
`okall:x` aprobar todas · `pl:cambios` pedir cambios al plan · `st:edit` corregir subtítulos · `vf:final` render final ·
`vr:<id>` regenerar voz · `pub:ahora|borrador|prog|edit|cancel`.
Las respuestas de texto que el bot espera (nuevo prompt, cambios, fecha) se guardan en SQLite y se descartan con `/cancelar`.

## Detalle por agente

| # | Skill | Modelo (`.env`) | Entradas → Salidas | Garantías |
|---|---|---|---|---|
| 1 | `capturar` | `MODEL_EXTRACT` | URL → `01_datos/*` | Anti-SSRF (también en las subpeticiones del navegador); imágenes extraídas del HTML, no “inventadas” por el LLM; `null` si falta un dato |
| 2 | `imagenes` | — | `propiedad.json` → `02_media/originales/*` | Formato real validado (sharp), logos/íconos descartados, duplicados por dHash, tope 25 MB, 3 reintentos |
| 3 | `prompts` | `MODEL_VISION` | originales → `03_prompts/*` | Vertical ⇒ sin extender; la restricción “no alterar nada” se agrega siempre; prompt editado a mano se conserva |
| 4 | `extender` | `MODEL_IMAGE` | originales + prompts → `04_extendidas/*` | **Paste-back** (los píxeles reales no los decide la IA), 1080×1920 exactos, fallback blur, topes de gasto |
| 5 | `guion` | `MODEL_TEXT`, `MODEL_VISION`, whisper | video + datos → `05_guion/*` | Subtítulos con tiempos por palabra; plan validado y reparado; “pedir cambios” solo regenera el plan |
| 5b | `voz` | `MODEL_TTS` | plan → `05_guion/voz/*.wav` | Lee el texto exacto, normaliza a −16 LUFS, duración real al plan |
| 6a | `estilo` | `MODEL_VISION` | referencia.mp4 → `estilo.json` | Editable a mano; ritmo medido con cortes reales |
| 6 | `video` | — (Remotion) | plan + estilo + cliente → `06_video/*` | Todo el diseño sale de `estilo.json`; borrador antes del final; un render a la vez |
| 9 | `publicar` | `MODEL_TEXT` | final.mp4 → post en Zernio | Nunca publica sin confirmación explícita; “ahora” pide doble confirmación |

## Costos y topes

Cada llamada de pago suma su costo real (`usage.cost` de OpenRouter) al agente, al proyecto y al día. Antes de
cada llamada se verifica `MAX_USD_PER_PROJECT` y `MAX_USD_PER_DAY`: si se superan, el agente se detiene y avisa
(lo ya hecho se conserva). `/estado` muestra el gasto. Con `MOCK=1` no se gasta nada.

## Cómo modificar un agente

1. **Su prompt**: editá `bot/skills/<id>/SKILL.md` (sección `## prompt:<nombre>`). Las variables `{{tono}}`, `{{idioma}}`… las reemplaza el código.
2. **Su modelo**: cambiá `MODEL_*` en el entorno y corré `npm run check-models`.
3. **Su lógica**: `bot/src/agents/<n>-*.ts`. Cada agente devuelve un `AgentResult` (texto, medios, botones); `registry.ts` lo conecta a la cola y a Telegram.
4. **Un agente nuevo**: módulo + skill + entrada en `registry.ts` (clase y handler) + comando en `telegram/bot.ts` + tests.
