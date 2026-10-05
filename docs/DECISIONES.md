# Decisiones y desvíos del instructivo

## Fase 1 (cimientos)
- **Fase 0 pendiente:** no se tuvo acceso a las carpetas reales de `clientes/` y `plantilla/`. `bot/src/paths.ts` implementa la estructura **objetivo** del instructivo (§3). Cuando se ejecute la Fase 0 (`docs/ESTRUCTURA-REAL.md`), solo hay que ajustar ese archivo.
  Los nombres de cliente/proyecto aceptan acentos y espacios (para respetar nombres reales) pero rechazan `..`, separadores, punto inicial y caracteres de control.
- **Modelos verificados** contra `GET /api/v1/models` de OpenRouter (2026-10-05): `google/gemini-2.5-flash` (texto/visión), `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash-image` (entrada y salida de imagen) y `openai/gpt-audio-mini` (salida de audio) existen con las modalidades requeridas. Precios aproximados: imagen de salida ≈ USD 0,00003/token (`image_output`), audio de salida ≈ USD 0,0000024/token. Re-validar con `npm run check-models` antes de cada despliegue.
- **Cola:** SQLite (`better-sqlite3`) con worker en proceso: heavy=1, light=3. Cancelación vía `AbortSignal`: los agentes futuros deben respetar `ctx.signal`.
- **Manifest:** el bloqueo es **en proceso** (cola de promesas por archivo) + escritura atómica (tmp + rename). Válido porque el bot es un único proceso; no ejecutar dos instancias sobre el mismo volumen.
- **Webhook:** se verifica el `secret_token` con comparación de tiempo constante *antes* de pasar la petición a grammY, y el bot se inicializa (`getMe`) al arrancar para fallar rápido con un token inválido.
- Docker/Dokploy (Fase 8) y el resto de agentes (Fases 2–9) aún no están implementados; los comandos correspondientes responden "todavía no está implementado (Fase N)".
