# Bot de Telegram para agencia inmobiliaria

Agentes controlados desde Telegram que convierten la ficha web de una propiedad en un video vertical editado:

`/capturar <url>` → `/imagenes` → `/prompts` → `/extender` → `/subir` + `/guion` → `/voz` → `/video` → `/publicar`

| Documento | Contenido |
|---|---|
| [`docs/AGENTES.md`](docs/AGENTES.md) | Cada agente, su skill, su trigger, modelo, entradas/salidas y garantías |
| [`docs/ESTRUCTURA.md`](docs/ESTRUCTURA.md) | Estructura de **clientes** y de cada **propiedad**, `cliente.json`, `manifest.json`, plan de edición |
| [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) | Puesta en marcha en Dokploy (Docker Compose + Bot API local) |
| [`docs/INSTRUCTIVO.md`](docs/INSTRUCTIVO.md) | Plan original por fases (referencia) |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones, desvíos y **lo que no se pudo verificar** |
| [`CLAUDE.md`](CLAUDE.md) | Reglas para trabajar con Claude Code en este repo |

## Estado

| Pieza | Estado |
|---|---|
| Cimientos: config, rutas seguras, manifest, cola SQLite, lista blanca, webhook | ✅ |
| Agentes 1–4 (capturar, imágenes, prompts, extender) | ✅ probados con LLM simulado y fixtures; Chromium real |
| Agente 5/5b (guion, plan de edición, voz) | ✅ probado con transcriptor/LLM simulados; whisper.cpp **sin probar** |
| Agente 6/6a (estilos, video con Remotion) | ✅ render real verificado de punta a punta |
| Agente 9 (publicar con Zernio) | ✅ flujo según la documentación oficial; probado con `fetch` simulado, **sin cuenta real** |
| Skills por agente (`bot/skills/`) y triggers de Telegram | ✅ |
| Docker/Dokploy | ⚠️ escrito, **imagen no construida** (ver `docs/DESPLIEGUE.md`) |
| Llamadas reales a OpenRouter (imagen, voz, JSON estricto) y Telegram en vivo | ⚠️ **sin probar** (se necesita tu API key y tu bot) |

## Arranque rápido (desarrollo)

```bash
cd bot && npm install
cp ../.env.example .env        # TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS y OPENROUTER_API_KEY (o MOCK=1)
# en .env: NODE_ENV=development  DATA_DIR=./data
npm run init-data              # crea clientes/ y plantilla/ de ejemplo (no pisa nada)
npm run dev                    # polling: probá /start, /nuevocliente, pegá una URL…
npm test                       # ~115 tests (los que usan Chromium/Remotion se omiten si no están)
npm run check-models           # valida los MODEL_* contra OpenRouter y muestra precios
```
Para el video: `cd my-video && npm install` (Remotion). Vista previa interactiva: `npm run dev` ahí.

Con `MOCK=1` todo corre sin gastar créditos (LLM, imágenes y voz simulados; el render usa ffmpeg en vez de Remotion).
