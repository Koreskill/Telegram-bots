# Decisiones y desvíos del instructivo

## Fase 1 (cimientos)
- **Fase 0 pendiente:** no se tuvo acceso a las carpetas reales de `clientes/` y `plantilla/`. `bot/src/paths.ts` implementa la estructura **objetivo** del instructivo (§3). Cuando se ejecute la Fase 0 (`docs/ESTRUCTURA-REAL.md`), solo hay que ajustar ese archivo.
  Los nombres de cliente/proyecto aceptan acentos y espacios (para respetar nombres reales) pero rechazan `..`, separadores, punto inicial y caracteres de control.
- **Modelos verificados** contra `GET /api/v1/models` de OpenRouter (2026-10-05): `google/gemini-2.5-flash` (texto/visión), `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash-image` (entrada y salida de imagen) y `openai/gpt-audio-mini` (salida de audio) existen con las modalidades requeridas. Precios aproximados: imagen de salida ≈ USD 0,00003/token (`image_output`), audio de salida ≈ USD 0,0000024/token. Re-validar con `npm run check-models` antes de cada despliegue.
- **Cola:** SQLite (`better-sqlite3`) con worker en proceso: heavy=1, light=3. Cancelación vía `AbortSignal`: los agentes futuros deben respetar `ctx.signal`.
- **Manifest:** el bloqueo es **en proceso** (cola de promesas por archivo) + escritura atómica (tmp + rename). Válido porque el bot es un único proceso; no ejecutar dos instancias sobre el mismo volumen.
- **Webhook:** se verifica el `secret_token` con comparación de tiempo constante *antes* de pasar la petición a grammY, y el bot se inicializa (`getMe`) al arrancar para fallar rápido con un token inválido.
- Docker/Dokploy (Fase 8) y el resto de agentes (Fases 2–9) aún no están implementados; los comandos correspondientes responden "todavía no está implementado (Fase N)".

## Fases 2–9 (implementación completa)

### Decisiones
- **Transcripción: whisper.cpp (CPU) con `@remotion/install-whisper-cpp`**, no `@remotion/whisper-webgpu` (que es lo que recomienda la skill de captions de `my-video/`): un VPS no tiene GPU. Da timestamps por token → se agrupan en palabras (`lib/transcripcion.ts`).
- **Imágenes/videos de la propiedad se extraen del HTML (cheerio), no los transcribe el LLM.** El modelo solo indica qué candidatas `[IMG#n]` son fotos de la propiedad. Evita URLs inventadas y es más barato.
- **Zernio** (documentación leída el 2026-10-05): `POST /v1/media/presign` → `PUT` a `uploadUrl` → `POST /v1/posts` con `mediaItems[{type:"video",url}]`, `platforms[{platform,accountId}]` y `publishNow` | `scheduledFor`+`timezone` | (sin nada = borrador). Un solo video se publica como Reel. Base: `https://zernio.com/api/v1` (configurable con `ZERNIO_BASE_URL`).
- **`/todo` encadena solo 1→2→3** (`manifest.auto`) y se detiene para aprobar: los pasos que gastan créditos (extender, voz, video) siempre requieren un clic.
- **Skills de agente = archivos `SKILL.md` que el bot lee en ejecución** (metadatos + `## prompt:<nombre>`). Cambiar un prompt no requiere tocar código.
- **El plan de edición lo repara código determinista** (`agents/plan.ts`) después del LLM: tiempos en rango, un chip a la vez, inserts sin solaparse y ≤ 40 % del video, tarjeta final garantizada.
- **Estilo**: si no hay `estilo.json`, se arma uno base con los colores/fuente de `cliente.json`.
- **Publicar**: “Publicar ahora” pide una segunda confirmación; no existe ninguna ruta de código que publique sin un clic explícito.
- **Remotion**: `my-video/` ya no tiene la composición de plantilla; hay una composición única `Edicion` parametrizada. Se renderiza con el CLI (`npx remotion render`) como proceso hijo cancelable.
- **Tests**: un `MockLlm` valida las respuestas con el mismo zod que las reales; `__permitirRedPrivadaSoloTests` existe solo para servir fixtures desde localhost y lanza error fuera de tests.

### Bugs encontrados y corregidos al probar
- `assertBudget` leía un manifest inexistente al capturar (todavía no hay proyecto).
- `extractFrames` pedía un fotograma en el instante exacto final del video (no genera archivo).
- En Remotion, `objectFit` dentro de `style` se ignora en `<Video>` de `@remotion/media` (debe ser prop) y dos `<Video>` en un `AbsoluteFill` se apilaban en columna (detectado con un render real).
- Un token de Telegram inválido tiraba el proceso desde el webhook (ahora falla al arrancar con mensaje claro).

### Qué NO se pudo verificar (hay que probarlo con tus credenciales / en tu VPS)
1. **OpenRouter en vivo**: `check-models` confirmó que los modelos existen con las modalidades correctas, pero no se hicieron llamadas de pago: ni el JSON estricto (`response_format` con el esquema generado por zod), ni `image_config.aspect_ratio` con `gemini-2.5-flash-image`, ni el audio por streaming de `gpt-audio-mini`. Los tres se probaron contra respuestas simuladas con el formato documentado. **Hacé primero una corrida real con un proyecto chico.**
2. **Telegram en vivo**: los handlers se prueban con `bot.handleUpdate` y un transformer de API; no con un bot real. Tampoco el servidor Bot API local.
3. **whisper.cpp**: la compilación y la descarga del modelo no se ejecutaron en este entorno.
4. **Zernio en vivo**: probado con `fetch` simulado según la documentación; no hay cuenta real.
5. **Docker**: el `Dockerfile` no se construyó (sin daemon); `docker compose config` valida el compose.
6. **Calidad de la extensión de imágenes** con el modelo real (el paste-back protege los píxeles originales, pero la continuidad de los bordes depende del modelo): comparar `gemini-2.5-flash-image`, `openai/gpt-5-image-mini` y otro con las mismas 5 fotos.
7. **Voz en español rioplatense** de `gpt-audio-mini`: puede que convenga otro modelo/proveedor (la interfaz `Llm.speech` lo permite).
8. **Fase 0** (adaptar `paths.ts` a tus carpetas reales) sigue pendiente: la estructura implementada es la objetivo de `docs/ESTRUCTURA.md`.
