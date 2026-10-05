# Instructivo de implementación — Bot de Telegram para agencia inmobiliaria

> Documento para ejecutar con **Claude Code local**. Está pensado para trabajarse **fase por fase**.
> Cada fase tiene: objetivo, un **prompt listo para pegar**, pasos técnicos, y **criterios de aceptación**.
> No avances a la siguiente fase hasta cumplir los criterios de la actual.

---

## 0. Cómo usar este documento

1. Clona este repo en tu máquina y abre Claude Code en la raíz.
2. Claude Code lee `CLAUDE.md` (reglas permanentes) automáticamente. Dile: *"Lee `docs/INSTRUCTIVO.md` completo y empezamos por la Fase 0."*
3. En cada fase pega el bloque **"Prompt para Claude Code"**. Revisa el resultado, corre las pruebas de la fase y haz commit.
4. Si algo de este instructivo contradice la realidad (un modelo cambió de ID, la API de Zernio es distinta, tus carpetas no coinciden), **manda la realidad** y anota la diferencia en `docs/DECISIONES.md`.

**Importante sobre lo "no verificado":** los IDs de modelos de OpenRouter y la API de Zernio cambian con frecuencia y no pude verificarlos en vivo al escribir esto. Por eso todos los modelos van en variables de entorno y la Fase 1 incluye un script que los valida contra la API real.

---

## 1. Decisiones de arquitectura (ya tomadas)

| Tema | Decisión | Motivo |
|---|---|---|
| Lenguaje | **TypeScript (Node 22)** en todo el sistema | Remotion (ya en `my-video/`) es TypeScript; un solo lenguaje |
| Canal del bot | **API oficial de Telegram Bot (grammY) por webhook**, no Zernio | Zernio es una API de publicación/programación en redes; para recibir comandos y botones se necesita la Bot API. Zernio entra como paso opcional final (`/publicar`, Fase 9) |
| Servidor Bot API | **telegram-bot-api local** (contenedor) junto al bot | La API en la nube limita descargas a 20 MB y subidas a 50 MB. El servidor local sube eso a 2 GB, necesario para tus videos grabados |
| Modelos IA | **OpenRouter** para texto, visión, imagen y voz | Una sola API key, precios bajos, intercambiable |
| Transcripción | **whisper.cpp vía `@remotion/install-whisper-cpp`**, local en el contenedor | Da timestamps por palabra (necesarios para subtítulos premium). OpenRouter no los ofrece |
| Edición de video | **Remotion** (`my-video/`) + ffmpeg | Ya está en el repo, con skills oficiales de Remotion en `.claude/skills/` |
| Cola de trabajos | **SQLite** (`better-sqlite3`) + worker en el mismo proceso | Un solo usuario; sin Redis |
| Estado por proyecto | `manifest.json` en la carpeta del proyecto | Cada agente es reanudable |
| Despliegue | **Dokploy** (Docker Compose desde Git) en tu VPS | Ya lo tienes levantado |
| Validación de datos | **zod** en toda entrada/salida de LLM | Los LLM devuelven JSON inválido a veces; se valida y reintenta |

### Ruta de agentes y comandos

| # | Comando | Agente | Entrada | Salida |
|---|---|---|---|---|
| 1 | `/capturar <url>` | Extractor | URL de la inmobiliaria | Proyecto nuevo + `propiedad.json` |
| 2 | `/imagenes` | Descargador de medios | `propiedad.json` | Imágenes y video en `02_media/` |
| 3 | `/prompts` | Prompts de extensión | Imágenes originales | `03_prompts/*.json` |
| 4 | `/extender` | Extensor de imágenes | Prompts + imágenes | Imágenes 9:16 en `04_extendidas/` |
| 5 | `/guion` | Preparación del video | Video grabado + datos + imágenes | `05_guion/edit-plan.json` + subtítulos |
| 5b | `/voz` (opcional) | Voz en off | Guion | Audio en `05_guion/voz/` |
| 6 | `/video [estilo]` | Generador de video | Plan + plantilla de estilos | `.mp4` final |
| — | `/subir` | Recibir video grabado | Archivo por Telegram | `02_media/video_grabado/` |
| — | `/cliente` `/proyecto` `/estado` `/todo` `/cancelar` | Utilidades | | |
| 9 | `/publicar` (opcional) | Zernio | Video final | Publicado/programado |

---

## 2. Cuentas, credenciales y datos que debes tener listos

Marca cada ítem antes de empezar:

- [ ] **Bot de Telegram**: habla con `@BotFather` → `/newbot` → guarda `TELEGRAM_BOT_TOKEN`.
- [ ] **Tu `chat_id`**: escribe a `@userinfobot` → guarda `TELEGRAM_ALLOWED_IDS` (varios separados por coma).
- [ ] **`api_id` y `api_hash` de Telegram**: entra a https://my.telegram.org → *API development tools* → crea app. Son `TELEGRAM_API_ID` y `TELEGRAM_API_HASH` (para el servidor local).
- [ ] **OpenRouter**: https://openrouter.ai/keys → `OPENROUTER_API_KEY`. Carga saldo (con USD 10 alcanza para probar todo). Configura un **límite de gasto** en la key.
- [ ] **VPS con Dokploy**: acceso al panel, un dominio/subdominio apuntando al VPS (ej. `bot.tuagencia.com`), y **mínimo 4 GB de RAM** libres para los renders de Remotion (ideal 8 GB).
- [ ] **Ruta absoluta en el VPS** donde vivirá (o ya vive) tu carpeta de clientes, ej. `/srv/agencia/`.
- [ ] **Zernio** (opcional, Fase 9): API key y los IDs de cuentas sociales de cada cliente.
- [ ] **Repo en GitHub** conectado a Dokploy.

---

## 3. Estructura del repositorio y de los datos

```
/                                   (raíz del repo)
├── CLAUDE.md                       reglas permanentes para Claude Code
├── docs/
│   ├── INSTRUCTIVO.md             este archivo
│   ├── ESTRUCTURA-REAL.md         (Fase 0) cómo son TUS carpetas
│   └── DECISIONES.md              (se crea en la marcha) desvíos y motivos
├── bot/                            servicio Node/TS
│   ├── src/
│   │   ├── index.ts                arranque, webhook, healthz
│   │   ├── config.ts               env + zod
│   │   ├── paths.ts                ÚNICO lugar que conoce la estructura de carpetas
│   │   ├── telegram/               comandos, teclados, progreso
│   │   ├── queue/                  SQLite + worker
│   │   ├── project/                manifest, slug, cliente
│   │   ├── llm/                    openrouter.ts (chat, visión, imagen, audio)
│   │   ├── agents/
│   │   │   ├── 1-capturar.ts  2-imagenes.ts  3-prompts.ts
│   │   │   ├── 4-extender.ts  5-guion.ts  5b-voz.ts  6-video.ts
│   │   │   └── 9-publicar.ts
│   │   ├── schemas/                zod: propiedad, manifest, edit-plan, estilo
│   │   └── lib/                    ffmpeg, whisper, http seguro, imagen
│   ├── test/ (vitest)  fixtures/
│   ├── scripts/check-models.ts
│   ├── Dockerfile
│   └── package.json
├── my-video/  → (se mantiene) proyecto Remotion; se vuelve paramétrico en Fase 6
├── docker-compose.yml
└── .env.example

DATOS (fuera del repo, volumen montado en /data):
/data
├── clientes/
│   └── <cliente>/
│       ├── cliente.json            marca, colores, logo, contacto, tono, redes
│       └── proyectos/<propiedad-slug>/
│           ├── manifest.json
│           ├── 01_datos/     propiedad.json, pagina.html, captura.png
│           ├── 02_media/     originales/, video_grabado/
│           ├── 03_prompts/
│           ├── 04_extendidas/
│           ├── 05_guion/     transcripcion.json, subtitulos.srt, edit-plan.json, voz/
│           └── 06_video/     final.mp4, previews/
└── plantilla/
    ├── estilos/<nombre>/      referencia.mp4, estilo.json (se genera)
    ├── animaciones/           (opcional) componentes o assets reutilizables
    ├── fuentes/  musica/  logos/
```

> Esta es la estructura **objetivo**. Tus carpetas reales mandan: la Fase 0 mapea una a la otra y todo el código accede a las rutas **solo** a través de `paths.ts`.

---

## FASE 0 — Reconocimiento de tus carpetas reales

**Objetivo:** que Claude Code conozca tu estructura real de `clientes/` y `plantilla/` antes de escribir código, sin modificar nada.

### Prompt para Claude Code
```
Lee CLAUDE.md y docs/INSTRUCTIVO.md. Estamos en la Fase 0.
Mis carpetas reales están en: <RUTA ABSOLUTA LOCAL a tu carpeta de clientes y plantilla>.
Tareas (SOLO LECTURA, no muevas ni borres nada):
1. Lista el árbol (3 niveles) de la carpeta de clientes y de la de plantilla.
2. Abre 2 clientes de ejemplo y 2 estilos de plantilla; resume qué archivos tienen y su formato
   (json, md, mp4, fuentes, etc.).
3. Escribe docs/ESTRUCTURA-REAL.md con: árbol real, convenciones de nombres, qué datos del cliente
   ya existen (logo, colores, tono, contacto) y dónde, y cómo se guardan hoy los proyectos si existen.
4. Propón un mapeo real → estructura objetivo del INSTRUCTIVO (sección 3) y lista las diferencias.
5. Termina con una lista de preguntas para mí. No escribas código todavía.
```

### Qué debes revisar
- Que el mapeo respete tu forma de trabajar (no renombrar carpetas existentes sin tu OK).
- Que quede claro dónde viven los **logos, colores y fuentes** de cada cliente.
- Cómo están nombrados los videos de referencia de `plantilla/` (para el Agente 6).

### Criterios de aceptación
- [ ] `docs/ESTRUCTURA-REAL.md` existe y refleja tus carpetas reales.
- [ ] Las preguntas están respondidas y las respuestas anotadas en `docs/DECISIONES.md`.
- [ ] Tienes definido el esquema de `cliente.json` (campos mínimos en Apéndice B.1).

---

## FASE 1 — Cimientos: bot, config, cola, manifest

**Objetivo:** un bot que responde solo a ti, elige cliente/proyecto, encola trabajos y reporta estado. Sin agentes todavía.

### Prompt para Claude Code
```
Fase 1 del INSTRUCTIVO. Crea bot/ (Node 22, TypeScript estricto, ESM) con:
- grammY para Telegram, vitest para tests, zod para validación, better-sqlite3 para la cola.
- config.ts que lee y valida TODAS las variables del Apéndice C (falla al arrancar si falta alguna obligatoria).
- paths.ts: única fuente de verdad de rutas (usa docs/ESTRUCTURA-REAL.md). Sanitiza slugs y
  bloquea path traversal ("..", rutas absolutas, caracteres raros).
- project/manifest.ts: leer/escribir manifest.json con el esquema del Apéndice B.2, escritura atómica
  (archivo temporal + rename) y bloqueo para que dos agentes no escriban a la vez.
- queue/: tabla jobs(id, tipo, proyecto, estado, payload, error, creado, iniciado, terminado).
  Un worker con concurrencia 1 para trabajos pesados (extender, video) y 3 para livianos.
  Al arrancar, los jobs en "running" pasan a "error: reinicio" y se avisa por Telegram.
- Telegram: middleware de lista blanca (TELEGRAM_ALLOWED_IDS; todo lo demás se ignora en silencio),
  comandos /start /cliente /proyecto /estado /cancelar con teclados inline. callback_data <= 64 bytes
  (usa ids cortos, no rutas). Helper de progreso que edita UN mensaje (throttle 1 edición/2 s).
- index.ts: servidor HTTP con /healthz y el webhook de Telegram con secret_token verificado.
  Modo polling si NODE_ENV=development.
- scripts/check-models.ts: llama GET https://openrouter.ai/api/v1/models, comprueba que existan los
  IDs de MODEL_* del .env y que soporten la modalidad que necesitamos (ver Apéndice A.6); imprime
  precios por millón de tokens / por imagen.
- Tests: manifest (concurrencia, atomicidad), paths (traversal), cola (recuperación al reiniciar),
  whitelist.
Haz commits pequeños. No implementes agentes aún.
```

### Notas técnicas
- **Webhook**: `setWebhook` con `url=https://bot.tudominio.com/telegram/<ruta-secreta>`, `secret_token=<TELEGRAM_WEBHOOK_SECRET>`, `allowed_updates=["message","callback_query"]`. Verifica el header `X-Telegram-Bot-Api-Secret-Token`.
- **Límites de Telegram**: 4096 caracteres por mensaje, ~1 mensaje/seg por chat, `sendMediaGroup` máximo 10 elementos. El helper de mensajes debe partir textos largos.
- **Un solo usuario/chat activo**: guarda `cliente_activo` y `proyecto_activo` por `chat_id` en SQLite.

### Criterios de aceptación
- [ ] Con `npm run dev` (polling), `/start` te responde y a otro usuario no.
- [ ] `/cliente` lista los clientes **reales** de tu carpeta con botones.
- [ ] `/estado` muestra la tabla de agentes del proyecto activo leyendo `manifest.json`.
- [ ] `npm test` pasa. `npm run check-models` imprime la validación y precios.
- [ ] Reiniciar el proceso con un job en curso no deja el estado corrupto.

---

## FASE 2 — Agentes 1 y 2: capturar y descargar

### Agente 1 — `/capturar <url>`

**Objetivo:** extraer los datos de la propiedad desde la web de la inmobiliaria y crear el proyecto.

#### Prompt para Claude Code
```
Fase 2, Agente 1. Implementa bot/src/agents/1-capturar.ts y el comando /capturar <url> [cliente].
Flujo:
1. Valida la URL: solo http/https; resuelve DNS y BLOQUEA IPs privadas/loopback/link-local (anti-SSRF);
   máx. 5 redirecciones; timeout 30 s.
2. Descarga con Playwright (Chromium headless, user-agent normal, espera a networkidle, scroll hasta
   el final para disparar lazy-load). Guarda pagina.html y captura.png en 01_datos/.
3. Reduce el HTML: elimina script/style/svg/nav/footer, conserva texto, enlaces, <img> (src, srcset,
   data-src, data-lazy-src), <source>, <video>, <iframe> de YouTube/Vimeo, JSON-LD y meta og:*.
4. Envía el HTML reducido al LLM (MODEL_EXTRACT) con structured output (JSON schema del Apéndice B.3).
   Si el JSON no valida con zod, reintenta hasta 2 veces mandando el error de validación.
5. De srcset/lazy-load elige la URL de MAYOR resolución. Resuelve URLs relativas contra la base.
6. Crea el proyecto en el cliente (slug = ubicacion-tipo-titulo, único; si existe, sufijo -2).
   Escribe propiedad.json y actualiza manifest.json. Si no se indicó cliente, usa el activo; si no hay,
   pregunta con botones.
7. Responde por Telegram con un resumen (precio, m², ambientes, nº de imágenes encontradas) y la lista
   de CAMPOS VACÍOS. Botones: [Continuar a /imagenes] [Editar datos] [Cancelar].
Reglas: no inventes datos; si un campo no está en la página va null. Registra el costo de la llamada al
LLM en el manifest. Tests con 3 HTML de ejemplo en bot/test/fixtures/ (te los doy yo).
```

#### Modelo y API
- Modelo: `MODEL_EXTRACT` (defecto recomendado: `google/gemini-2.5-flash`: barato, contexto largo).
- Llamada: ver **Apéndice A.2** (chat + JSON schema).
- Prompt de sistema: **Apéndice E.1**.

### Agente 2 — `/imagenes`

**Objetivo:** descargar todas las imágenes y el video de la propiedad.

#### Prompt para Claude Code
```
Fase 2, Agente 2. Implementa bot/src/agents/2-imagenes.ts y /imagenes (también se llama dentro de
/capturar con el flag --media).
1. Lee propiedad.json.imagenes. Descarga con concurrencia 4, reintentos con backoff (3), timeout 60 s,
   mismo guardrail anti-SSRF, tope de 25 MB por archivo.
2. Valida con sharp: formato real (no confiar en la extensión), ancho >= 800 px. Descarta íconos, logos,
   banners, sprites (por tamaño y por aspecto extremo). Convierte webp/avif a jpg de calidad alta.
3. Deduplica por hash perceptual (dHash) y por tamaño: si hay varias resoluciones de la misma foto,
   conserva la mayor.
4. Guarda como 02_media/originales/img_001.jpg ... en el orden de la página, y un indice.json con:
   archivo, ancho, alto, orientación, url de origen, hash.
5. Videos: si hay mp4 directo, descárgalo; si es YouTube/Vimeo usa yt-dlp (instálalo en el Dockerfile)
   solo si el cliente lo autorizó (campo cliente.json.permite_descargar_video_embed).
6. Envía a Telegram un álbum de miniaturas (máx. 10 por media group, en lotes) y el recuento:
   descargadas / descartadas (con motivo).
Tests: dedupe, descarte de logos, conversión de formatos.
```

#### Criterios de aceptación de la Fase 2
- [ ] `/capturar` con 3 sitios reales de inmobiliarias genera `propiedad.json` válido.
- [ ] El proyecto aparece bajo el cliente correcto, con la estructura de carpetas completa.
- [ ] `/imagenes` descarga fotos en buena resolución, sin logos ni duplicados.
- [ ] Una URL a `http://169.254.169.254` o `http://localhost` es **rechazada**.
- [ ] El manifest muestra estado `done` y costo de cada agente.

---

## FASE 3 — Agente 3: prompts de extensión a vertical

**Objetivo:** por cada imagen, un prompt preciso para extenderla a **9:16 (1080×1920)** sin alterar lo real.

#### Prompt para Claude Code
```
Fase 3. Implementa bot/src/agents/3-prompts.ts y /prompts.
Para cada imagen de 02_media/originales/ (en lotes de 4 en paralelo):
1. Redimensiona a máx. 1280 px de lado largo para el LLM (ahorra tokens).
2. Llama a MODEL_VISION con la imagen y el prompt de sistema del Apéndice E.2. Respuesta con JSON schema
   (Apéndice B.4): tipo_ambiente, descripcion_corta (para que el guionista sepa qué muestra), calidad
   (1-5), orientacion_original, estrategia_extension, prompt_extension (en inglés), riesgos, usable (bool).
3. Estrategia según orientación: horizontal → hay que crear mucho arriba y abajo (la imagen queda en el
   centro); vertical ya 9:16 → no extender (estrategia "ninguna"); cuadrada → crear arriba y abajo
   moderado. El prompt debe nombrar explícitamente qué continuar por arriba (cielo, techo, copas) y por
   abajo (piso, pasto, vereda, mesada), y repetir la restricción "do not alter, move, add or remove any
   object, furniture, wall, window, building or person present in the original".
4. Guarda 03_prompts/img_001.json (nombre igual a la imagen) y arma 03_prompts/resumen.md.
5. Telegram: mensaje con tabla (imagen, tipo, calidad, usable) y botones [Editar prompt N]
   [Aprobar todos y /extender]. Editar permite responder con un nuevo texto que reemplaza el prompt.
Tests con 5 fotos en fixtures (interior, exterior, aérea, vertical, baja calidad).
```

#### Modelo
`MODEL_VISION` (defecto: `google/gemini-2.5-flash`). Llamada: **Apéndice A.3**.

#### Criterios de aceptación
- [ ] Cada imagen tiene su `.json` válido; las verticales marcan `estrategia: "ninguna"`.
- [ ] Las fotos "no usables" (borrosas, oscuras) quedan marcadas y excluidas del siguiente paso.
- [ ] Puedes editar un prompt desde Telegram y queda guardado.

---

## FASE 4 — Agente 4: extender imágenes (OpenRouter)

**Objetivo:** generar la imagen 9:16 **conservando intactos los píxeles reales** de la propiedad.

#### Estrategia (clave del sistema)
1. El modelo de imagen genera una versión 9:16 a partir de la foto + prompt.
2. **Paste-back**: se coloca la foto original (escalada al ancho final) sobre el centro del resultado con una máscara de borde difuminado de ~24 px. Así el contenido real nunca es alterado por la IA; la IA solo "inventa" las franjas de arriba y abajo.
3. Se normaliza a exactamente **1080×1920**.
4. Fallback barato y determinista (sin IA): fondo desenfocado (la misma foto ampliada + blur + oscurecido) con la original al centro. Se ofrece como botón si la IA falla 2 veces.

#### Prompt para Claude Code
```
Fase 4. Implementa bot/src/agents/4-extender.ts, bot/src/lib/imagen.ts y /extender.
- llm/openrouter.ts: función generarImagen({modelo, prompt, imagenBase64, aspectRatio}) según el
  Apéndice A.4 (modalities ["image","text"], image_config.aspect_ratio "9:16"). Extrae
  choices[0].message.images[0].image_url.url (data URL base64). Pide usage.include=true y guarda el costo.
- Para cada imagen usable cuyo JSON no diga estrategia "ninguna": llama al modelo, aplica el paste-back
  con sharp (máscara con degradado de borde), normaliza a 1080x1920 (fit cover para el fondo, original
  centrada conservando proporción) y guarda en 04_extendidas/img_001.png.
- Validaciones automáticas: dimensiones exactas; que el centro sea muy similar a la original
  (SSIM o diferencia media baja tras el paste-back); si falla, un reintento con el prompt reforzado
  y luego marcar "revisar".
- Concurrencia 2, reintentos con backoff ante 429/5xx, timeout 120 s, tope MAX_USD_PER_PROJECT
  (detén el agente y avisa antes de excederlo).
- Telegram: envía las extendidas en álbumes con botones por imagen [Regenerar] [Usar blur (sin IA)]
  [Aprobar]. Regenerar acepta un texto opcional para ajustar el prompt. Estado "aprobada" por imagen
  en el manifest.
- Modo MOCK=1: devuelve una imagen de prueba sin gastar créditos (para tests y desarrollo).
Tests: paste-back conserva el centro; normalización 1080x1920; fallback blur; límite de costo.
```

#### Modelos (en `.env`)
| Variable | Defecto sugerido | Alternativa |
|---|---|---|
| `MODEL_IMAGE` | `google/gemini-2.5-flash-image` (económico, edita con imagen de entrada) | `openai/gpt-5-image-mini`; `google/gemini-3-pro-image-preview` si necesitas más calidad |

> Antes de producción, prueba **las 3 opciones con las mismas 5 fotos** y elige por calidad/precio. Anota el resultado en `docs/DECISIONES.md`.

#### Criterios de aceptación
- [ ] Todas las salidas miden exactamente 1080×1920.
- [ ] En 10 fotos de prueba, el centro es idéntico a la original (por el paste-back).
- [ ] Sin red/créditos, el fallback blur produce un resultado correcto.
- [ ] El costo por imagen aparece en el manifest y el tope detiene el proceso.

---

## FASE 5 — Agente 5: preparación del video (transcripción, análisis, guion y plan de edición)

Tu video final es la **edición de un video real grabado**. Este agente produce el **plan de edición** completo: subtítulos premium, motion graphics e inserciones de imágenes.

### 5.1 `/subir` — recibir el video grabado
- Con el servidor Bot API local, el bot recibe videos de hasta 2 GB. Al subirlo (como **documento** para evitar compresión), el bot lo copia a `02_media/video_grabado/original.mp4`.
- Alternativa: dejar el archivo directamente en esa carpeta (SFTP/sincronización) y ejecutar `/guion`.
- Validar con `ffprobe`: duración, resolución, fps, rotación, pista de audio.

### 5.2 `/guion` — pasos del agente

#### Prompt para Claude Code
```
Fase 5. Implementa /subir y bot/src/agents/5-guion.ts. Pipeline:

A) NORMALIZAR (lib/ffmpeg.ts): ffprobe; si hay rotación o fps variable, genera 02_media/video_grabado/trabajo.mp4
   (CFR 30 fps, yuv420p, audio 48 kHz). Extrae audio a wav 16 kHz mono.

B) TRANSCRIBIR (lib/whisper.ts): usa @remotion/install-whisper-cpp (modelo "medium" multilingüe, idioma
   "es", tokenLevelTimestamps true) y convierte con toCaptions (lee .claude/skills/remotion-captions/ de
   my-video/ para la forma correcta). Guarda 05_guion/transcripcion.json con timestamps por palabra.

C) CORREGIR TRANSCRIPCIÓN: pasa el texto por MODEL_TEXT con un glosario (nombre del barrio, calles,
   marca, nombres propios de propiedad.json y cliente.json) para corregir errores de nombres propios
   SIN cambiar la estructura de palabras ni los tiempos (devuelve un mapa índice_palabra → corrección).
   Genera 05_guion/subtitulos.srt legible y envía el texto a Telegram con [Aprobar] [Corregir]
   (Corregir: el usuario responde con el texto corregido).

D) ANALIZAR EL VIDEO: ffmpeg detecta cortes (select='gt(scene,0.30)') y extrae un frame por segundo
   (y uno por cada corte) a 512 px. Envía lotes de frames con sus timestamps a MODEL_VISION y obtén la
   línea de tiempo por segmentos: inicio, fin, qué se ve (ambiente/amenity), si hay persona hablando,
   zona libre de la pantalla para gráficos (arriba/abajo/izquierda/derecha), y zonas a evitar (los
   subtítulos premium van en la zona segura). Guarda 05_guion/analisis.json. Referencia de nivel de
   detalle esperado: la tabla "Timeline of the source" de prompt-codex-finca-dos.md.

E) PLAN DE EDICIÓN: con MODEL_TEXT, usando transcripción + análisis + propiedad.json + cliente.json +
   descripciones de imágenes (03_prompts/*.json) genera 05_guion/edit-plan.json con el esquema del
   Apéndice B.5:
   - captions: parámetros de estilo (se completan en Fase 6 con el estilo elegido)
   - overlays: títulos, chips de amenities con icono, lower-third con ubicación/precio, etiquetas,
     barra de progreso, tarjeta final con CTA y logo del cliente, cada uno con start/end y props
   - inserts: imágenes extendidas (04_extendidas) que se insertan a pantalla completa o como panel
     cuando la narración menciona ese ambiente (start/end, movimiento: zoom suave/paneo)
   - vo: segmentos de voz en off OPCIONALES (texto, start), solo si el usuario lo pide
   - musica: pista sugerida de plantilla/musica y curva de volumen (ducking bajo la voz)
   Reglas: los inserts no deben tapar más de 2,5 s seguidos si habla el presentador; ningún overlay se
   superpone con la zona de subtítulos; todo texto legible en celular; no inventar datos que no estén en
   propiedad.json ni en el audio.

F) Valida el plan con zod y chequea coherencia (todo start<end, todo dentro de la duración, archivos
   existentes). Telegram: resumen en texto de la línea de tiempo + botones [Aprobar plan] [Pedir cambios]
   (cambios: el usuario escribe qué cambiar y se regenera solo esa parte).
```

#### Modelos
| Variable | Defecto sugerido | Uso |
|---|---|---|
| `MODEL_TEXT` | `anthropic/claude-sonnet-4.5` (o uno más barato como `google/gemini-2.5-flash` si la calidad alcanza) | corrección de transcripción, guion, plan |
| `MODEL_VISION` | `google/gemini-2.5-flash` | análisis de frames |
| Whisper | local `medium` | transcripción |

#### Subtítulos premium: especificación
- **Palabra por palabra**: grupos de 2–4 palabras, resaltando la palabra activa (color de acento del cliente + pequeño "pop" con spring).
- Tipografía bold/heavy sans, mínimo ~64 px sobre ancho 1080; contorno o sombra suave para legibilidad.
- **Zona segura de Reels/Shorts/TikTok**: evita el ~20 % inferior y ~10 % lateral derecho (botones de la app). Posición típica: tercio inferior-central, por encima de esa zona.
- Corte por pausas y puntuación, nunca dejar una palabra suelta de artículo/preposición al final de línea.
- Mayúsculas/minúsculas coherentes y números formateados (m², USD).

### 5b `/voz` — voz en off (opcional)

#### Prompt para Claude Code
```
Fase 5b. Implementa bot/src/agents/5b-voz.ts y /voz.
- Lee edit-plan.json.vo. Para cada segmento llama a OpenRouter con un modelo de salida de audio
  (MODEL_TTS, ver Apéndice A.5; stream=true, formato pcm16) y reconstruye el audio: concatena los
  chunks base64, guarda WAV (24 kHz mono) en 05_guion/voz/vo_001.wav.
- Normaliza con ffmpeg (loudnorm a -16 LUFS) y mide la duración real; ajusta start/end del plan.
- Instrucción de voz en el prompt: español rioplatense, tono cálido, profesional, ritmo medio, leer
  EXACTAMENTE el texto (sin añadir ni omitir palabras).
- Telegram: envía cada clip como audio con [Regenerar] [Aprobar] y selector de voz (VOICE por defecto).
- Interfaz TtsProvider para poder cambiar de proveedor (ElevenLabs, OpenAI directo) sin tocar el agente.
- Modo MOCK=1 genera silencio de la duración estimada.
```

> Si OpenRouter ya ofrece un endpoint de TTS dedicado cuando implementes esto, **prefiérelo** (revisa https://openrouter.ai/docs). Si el audio por chat no da calidad suficiente en español, implementa el otro proveedor tras `TtsProvider` y anótalo en `docs/DECISIONES.md`.

#### Criterios de aceptación de la Fase 5
- [ ] `/subir` acepta un video de ≥300 MB y lo deja en la carpeta del proyecto.
- [ ] La transcripción tiene timestamps por palabra y los nombres propios están corregidos.
- [ ] `analisis.json` describe correctamente al menos el 90 % de los segmentos en un video de prueba.
- [ ] `edit-plan.json` valida y puedes aprobarlo o pedir cambios desde Telegram.
- [ ] (Opcional) `/voz` genera audios aprobables y normalizados.

---

## FASE 6 — Agente 6: generar el video (Remotion)

**Objetivo:** renderizar el `.mp4` final: video real + subtítulos premium + motion graphics + inserciones de imágenes (+ voz y música), con el **estilo** tomado de `plantilla/`.

### 6.1 Analizar estilos de referencia (una vez por estilo)

```
Fase 6.1. Implementa bot/src/agents/6a-estilo.ts y el comando /estilos (lista y analiza).
Para cada carpeta de plantilla/estilos/<nombre>/ con referencia.mp4 y SIN estilo.json:
- Extrae frames a 2 por segundo (512 px) y detecta cortes con ffmpeg.
- Envía los frames por lotes a MODEL_VISION con el prompt del Apéndice E.4 y consolida un estilo.json
  (Apéndice B.6): paleta (hex), tipografías observadas (y la fuente libre más cercana de plantilla/fuentes),
  estilo de subtítulos (posición, tamaño relativo, resaltado, animación), tipos de transición y su
  duración, ritmo (cortes por minuto), patrones de motion graphics (chips, lower-thirds, barras, esquinas,
  tarjeta final), easing y velocidad de animación (springs vs. lineales), tratamiento de color (viñeta,
  contraste), uso de zoom y movimiento sobre imágenes.
- Envía a Telegram el estilo.json resumido con [Aprobar] [Ajustar]. Los valores aprobados son los que
  mandan: el usuario puede editar el JSON a mano.
```

### 6.2 Composición Remotion paramétrica

#### Prompt para Claude Code
```
Fase 6.2. Convierte my-video/ en un motor de edición. LEE PRIMERO las skills de my-video/.claude/skills
(remotion-best-practices, remotion-captions, remotion-multimedia, remotion-render, remotion-markup).
1. Composición "Edicion" cuyo input props es { editPlan, estilo, cliente, assets } con calculateMetadata
   para fijar la duración desde el plan. Resolución de salida 1080x1920 a 30 fps (parametrizable).
2. Capas, en este orden: (a) video real (OffthreadVideo, object-fit adecuado: si el original es
   horizontal, fondo desenfocado + video centrado, o recorte inteligente según plan), (b) inserts de
   imágenes con movimiento (zoom/paneo con interpolate, entradas/salidas con spring), (c) overlays de
   motion graphics, (d) subtítulos palabra por palabra, (e) viñeta y detalles de estilo, (f) tarjeta
   final. Audio: voz original, voz en off opcional y música con ducking.
3. Componentes reutilizables y tipados en my-video/src/components/: Subtitulos, ChipAmenity (con
   iconos SVG propios), LowerThird, EtiquetaAerea, BarraProgreso, TarjetaFinal (logo + CTA + contacto),
   InsertImagen, Transicion (fade, slide, wipe, zoom, whip). Cada uno toma sus colores, fuente, easing
   y duraciones del estilo.json, NO valores fijos en el código.
4. Fuentes con @remotion/fonts (loadFont) desde plantilla/fuentes o Google Fonts self-hosted.
5. Reglas de calidad: todo cálculo depende de useCurrentFrame (nada de CSS transitions, setTimeout ni
   Math.random sin semilla); textos que no se salgan de pantalla; contraste mínimo AA sobre el video.
6. Vista previa: script que renderiza un fotograma de cada overlay (renderStill) para validar sin render
   completo.
7. my-video/src/Root.tsx registra la composición; prueba con un edit-plan de ejemplo en
   my-video/fixtures/.
```

### 6.3 Agente 6 (orquestador de render)

```
Fase 6.3. Implementa bot/src/agents/6-video.ts y /video [estilo].
- Si no se indica estilo, ofrece botones con los de plantilla/estilos que tengan estilo.json.
- Prepara el "assets" (copia/enlaza video, imágenes extendidas, logo, fuentes, voz, música a un
  directorio temporal servido a Remotion con staticFile / --public-dir).
- Render previo "borrador": 540x960, calidad baja, concurrencia 2 → envía a Telegram con
  [Aprobar render final] [Pedir cambios]. Los cambios editan el edit-plan.json y repiten el borrador.
- Render final con @remotion/renderer (renderMedia): H.264, yuv420p, BT.709, crf 18-20, audio AAC 192k,
  +faststart. Progreso hacia Telegram (porcentaje cada 10 %).
- Entrega: si pesa < 50 MB, sendVideo (con servidor local hasta 2 GB); si no, deja el archivo en
  06_video/ y envía la ruta/enlace. Guarda 06_video/final.mp4 y un thumbnail.
- Control de recursos: un solo render a la vez, tope de memoria, timeout de 30 min, limpia temporales.
```

#### Criterios de aceptación de la Fase 6
- [ ] Un video de 60 s se renderiza en 540×960 (borrador) y en 1080×1920 (final) sin errores.
- [ ] Subtítulos sincronizados al milisegundo con la voz (revisa 5 puntos al azar).
- [ ] Ningún overlay tapa subtítulos ni sale del cuadro.
- [ ] Cambiar de `estilo` cambia visiblemente fuentes, colores, transiciones y ritmo **sin tocar código**.
- [ ] Licencia: Remotion es gratis para individuos y empresas de hasta 3 personas; si tu equipo es mayor, necesitas licencia de empresa (https://remotion.dev/license).

---

## FASE 7 — Orquestación, costos y robustez

```
Fase 7. Implementa:
- /todo <url> [cliente]: encadena 1→2→3 y se detiene en el punto de aprobación (prompts), sigue 4,
  se detiene para aprobar imágenes, pide el video con /subir, corre 5, pausa para aprobar el plan, y
  termina en 6. Cada pausa tiene botón [Continuar]. /cancelar detiene el trabajo activo (mata procesos
  hijos: ffmpeg, chromium, whisper).
- Costos: acumula el costo por agente y proyecto desde usage.cost de OpenRouter. /estado muestra el
  total. MAX_USD_PER_PROJECT y MAX_USD_PER_DAY: al 80 % avisa, al 100 % detiene.
- Reintentos idempotentes: cada agente puede re-ejecutarse y solo rehace lo que falta (compara hash de
  entradas guardado en el manifest). Flag --forzar para rehacer.
- Logs estructurados (pino) sin secretos; /logs <n> devuelve las últimas líneas del proyecto.
- Errores: mensaje claro al usuario (qué falló, qué hacer) y detalle técnico solo en logs.
- Limpieza: tarea semanal que borra temporales y renders borrador de proyectos con >30 días.
- Pruebas end-to-end con MOCK=1 (sin gastar) y una corrida real documentada en docs/PRUEBA-E2E.md.
```

**Criterios:** `/todo` completa un proyecto de principio a fin con MOCK=1; `/cancelar` deja el sistema limpio; un reinicio en medio no pierde estado.

---

## FASE 8 — Despliegue en Dokploy

### 8.1 Archivos

`bot/Dockerfile` (base, ajusta con Claude Code):
```dockerfile
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl python3 python3-pip git build-essential cmake \
    libnss3 libdbus-1-3 libatk1.0-0 libasound2 libxrandr2 libxkbcommon-x11-0 \
    libxfixes3 libxcomposite1 libxdamage1 libgbm-1 libcups2 libpango-1.0-0 libcairo2 \
    libatk-bridge2.0-0 libx11-xcb1 libxcb-dri3-0 fonts-liberation \
  && pip3 install --break-system-packages yt-dlp \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bot/package*.json bot/
COPY my-video/package*.json my-video/
RUN cd bot && npm ci && cd ../my-video && npm ci
COPY . .
RUN cd bot && npm run build \
 && cd ../my-video && npx remotion browser ensure \
 && cd ../bot && npx playwright install --with-deps chromium
# Pre-descarga del modelo whisper para no bajarlo en el primer uso
RUN cd bot && node dist/scripts/prewarm-whisper.js
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://localhost:3000/healthz || exit 1
CMD ["node", "bot/dist/index.js"]
```

`docker-compose.yml`:
```yaml
services:
  telegram-bot-api:
    image: aiogram/telegram-bot-api:latest
    restart: unless-stopped
    environment:
      TELEGRAM_API_ID: ${TELEGRAM_API_ID}
      TELEGRAM_API_HASH: ${TELEGRAM_API_HASH}
      TELEGRAM_LOCAL: "1"
    volumes:
      - tgdata:/var/lib/telegram-bot-api
  bot:
    build:
      context: .
      dockerfile: bot/Dockerfile
    restart: unless-stopped
    depends_on: [telegram-bot-api]
    env_file: .env
    environment:
      TELEGRAM_API_ROOT: http://telegram-bot-api:8081
    volumes:
      - /srv/agencia:/data              # TU carpeta real (clientes/ y plantilla/)
      - tgdata:/var/lib/telegram-bot-api  # para leer archivos descargados por el servidor local
    deploy:
      resources:
        limits:
          memory: 6g
volumes:
  tgdata:
```
> Ajusta `/srv/agencia` a tu ruta real y verifica permisos del usuario del contenedor sobre esa carpeta. En Dokploy los valores de `.env` se cargan desde la pestaña **Environment** del servicio, no se suben al repo.

### 8.2 Pasos en Dokploy
1. Panel → **Create Service → Compose** → tipo *Docker Compose*, origen **GitHub** (tu repo y rama), archivo `docker-compose.yml`.
2. Pestaña **Environment**: pega todas las variables del Apéndice C con sus valores reales.
3. Pestaña **Domains**: dominio `bot.tuagencia.com` → servicio `bot`, puerto `3000`, HTTPS con Let's Encrypt activado.
4. **Deploy**. Revisa los logs hasta ver `Bot listo`.
5. **Mover el bot al servidor local** (una sola vez; sin esto no funciona):
   ```bash
   # a) Cerrar sesión en la API en la nube (obligatorio antes de usar el servidor local)
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/logOut"
   # b) Registrar el webhook contra el servidor local, desde el contenedor del bot
   curl -X POST "http://telegram-bot-api:8081/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://bot.tuagencia.com/telegram/$TELEGRAM_WEBHOOK_PATH" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -d 'allowed_updates=["message","callback_query"]'
   ```
   (Claude Code puede automatizarlo en un script `npm run set-webhook`.)
   Después de `logOut` hay que esperar ~10 minutos antes de poder volver a la API en la nube.
6. Activa **Auto Deploy** (webhook de GitHub) para desplegar con cada push a `main`.
7. Escribe `/start` desde tu Telegram y corre una prueba completa.

### Criterios de aceptación
- [ ] `https://bot.tuagencia.com/healthz` responde 200.
- [ ] Subir un video de 500 MB por Telegram funciona.
- [ ] Reiniciar el contenedor conserva clientes, proyectos y la cola (el volumen persiste).
- [ ] Un render de 60 s completa sin que Dokploy mate el contenedor por memoria.

---

## FASE 9 — Zernio (opcional): publicar el video

**Qué es y qué no:** Zernio sirve para **publicar/programar** en redes (Instagram, TikTok, YouTube, etc.), no para recibir comandos de un bot. Por eso el canal de control es Telegram directo y Zernio se usa para el último paso.

```
Fase 9. ANTES de escribir código: lee la documentación oficial actual de Zernio (API de publicación,
autenticación, subida de media, programación) y resume en docs/ZERNIO.md los endpoints reales. No
asumas nada de memoria. Después implementa /publicar:
- Lee de cliente.json los IDs de cuentas sociales de Zernio.
- Sube 06_video/final.mp4 (o su URL pública) y crea el post con el copy que genera MODEL_TEXT
  (caption + hashtags según el cliente y la propiedad), con vista previa en Telegram.
- Botones: [Publicar ahora] [Programar...] [Cancelar]. NUNCA publica sin confirmación explícita.
- Guarda el id del post y el estado en manifest.json.
```
**Criterio:** el post aparece como borrador/programado en Zernio solo después de tu confirmación.

---

## APÉNDICE A — Referencia de APIs de OpenRouter

**Base URL:** `https://openrouter.ai/api/v1` · Header `Authorization: Bearer $OPENROUTER_API_KEY` · recomendados `HTTP-Referer: https://tuagencia.com` y `X-Title: Bot Inmobiliaria`.
Todas las llamadas usan `POST /chat/completions`. Agrega `"usage": {"include": true}` para recibir el costo real en la respuesta.

### A.1 Cliente base
Una sola función `chat(body)` con: timeout, reintentos con backoff exponencial ante 408/429/5xx (respetando `Retry-After`), registro de `usage.cost`, y redacción de secretos en logs.

### A.2 Texto con salida estructurada (Agente 1, guion)
```json
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    {"role": "system", "content": "<prompt E.1>"},
    {"role": "user", "content": "<HTML reducido>"}
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {"name": "propiedad", "strict": true, "schema": { "...": "ver B.3" }}
  },
  "temperature": 0.1,
  "usage": {"include": true}
}
```
Respuesta: `choices[0].message.content` (string JSON) → `JSON.parse` → zod. Si falla, reintenta enviando el error de validación.

### A.3 Visión (Agente 3 y análisis de video)
```json
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    {"role": "system", "content": "<prompt E.2>"},
    {"role": "user", "content": [
      {"type": "text", "text": "Analiza esta imagen."},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<BASE64>"}}
    ]}
  ],
  "response_format": {"type": "json_schema", "json_schema": {"name": "analisis_imagen", "strict": true, "schema": {"...": "ver B.4"}}}
}
```
Para video: múltiples `image_url` en un mismo mensaje, cada uno precedido por un texto `"t=12.0s"`.

### A.4 Generación/edición de imagen (Agente 4)
```json
{
  "model": "google/gemini-2.5-flash-image",
  "messages": [
    {"role": "user", "content": [
      {"type": "text", "text": "<prompt_extension del JSON de la imagen>"},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<BASE64>"}}
    ]}
  ],
  "modalities": ["image", "text"],
  "image_config": {"aspect_ratio": "9:16"},
  "usage": {"include": true}
}
```
Respuesta: `choices[0].message.images[0].image_url.url` = `data:image/png;base64,...`. Si `images` viene vacío, el modelo rechazó o respondió solo texto: reintenta una vez y luego marca "revisar".
Si el modelo elegido no respeta `image_config`, el agente igual normaliza a 1080×1920 (ver Fase 4).

### A.5 Voz en off (Agente 5b)
```json
{
  "model": "openai/gpt-audio-mini",
  "messages": [
    {"role": "system", "content": "Eres locutor profesional rioplatense. Lee EXACTAMENTE el texto del usuario, sin agregar ni omitir palabras. Tono cálido y confiable, ritmo medio."},
    {"role": "user", "content": "<texto del segmento>"}
  ],
  "modalities": ["text", "audio"],
  "audio": {"voice": "alloy", "format": "pcm16"},
  "stream": true
}
```
- El audio llega en streaming: junta `choices[0].delta.audio.data` (base64) de todos los chunks. `pcm16` = PCM 16-bit, 24 kHz, mono → conviértelo a WAV (cabecera) o con `ffmpeg -f s16le -ar 24000 -ac 1 -i in.pcm out.wav`.
- Voces típicas disponibles en la familia: `alloy`, `echo`, `nova`, `onyx`, `shimmer`, entre otras; verifica la lista vigente del modelo.
- **Si ya existe un endpoint de TTS dedicado en OpenRouter, úsalo en su lugar** (más simple y barato).

### A.6 Verificación de modelos (script `check-models`)
`GET /models` devuelve cada modelo con `architecture.input_modalities`, `architecture.output_modalities` y `pricing`. Comprueba:
- `MODEL_EXTRACT`, `MODEL_TEXT`: salida `text`, `supported_parameters` incluye `response_format`/`structured_outputs`.
- `MODEL_VISION`: entrada incluye `image`.
- `MODEL_IMAGE`: salida incluye `image`.
- `MODEL_TTS`: salida incluye `audio`.
También puedes filtrar con `?output_modalities=image` o `?output_modalities=audio`.

### A.7 Costos orientativos (confirma en `check-models`)
Imágenes extendidas: del orden de centavos de USD cada una con modelos "flash/mini". Texto/visión: fracciones de centavo por llamada. Voz: pocos centavos por minuto. Un proyecto típico (15 imágenes, 1 video de 60 s) debería quedar en pocos dólares; el tope `MAX_USD_PER_PROJECT` (sugerido 5) lo protege.

---

## APÉNDICE B — Esquemas de datos (zod / JSON Schema)

### B.1 `cliente.json`
```json
{
  "id": "inmobiliaria-demo",
  "nombre": "Inmobiliaria Demo",
  "marca": {
    "colores": {"primario": "#0d2b1e", "acento": "#b8f04a", "texto": "#ffffff"},
    "fuente": "Geist",
    "logo": "logos/logo.png"
  },
  "contacto": {"telefono": "", "whatsapp": "", "web": "", "instagram": ""},
  "tono": "cálido, profesional, cercano (rioplatense)",
  "idioma": "es-AR",
  "cta_por_defecto": "Coordiná tu visita",
  "permite_descargar_video_embed": false,
  "zernio": {"cuentas": []}
}
```

### B.2 `manifest.json`
```json
{
  "version": 1,
  "cliente": "inmobiliaria-demo",
  "slug": "palermo-depto-3amb",
  "url_origen": "https://...",
  "creado": "2026-10-05T12:00:00Z",
  "agentes": {
    "capturar":  {"estado": "done", "inicio": "", "fin": "", "salidas": ["01_datos/propiedad.json"], "costo_usd": 0.002, "hash_entrada": ""},
    "imagenes":  {"estado": "pending"},
    "prompts":   {"estado": "pending"},
    "extender":  {"estado": "pending", "aprobadas": []},
    "guion":     {"estado": "pending"},
    "voz":       {"estado": "skipped"},
    "video":     {"estado": "pending"},
    "publicar":  {"estado": "pending"}
  },
  "costo_total_usd": 0.002
}
```
Estados: `pending | running | done | error | skipped`. Error incluye `mensaje`.

### B.3 `propiedad.json` (salida del Agente 1)
Campos (todos `null` si no aparecen en la página): `titulo`, `tipo_operacion` (venta|alquiler), `tipo_propiedad`, `precio {monto, moneda}`, `expensas`, `ubicacion {direccion, barrio, ciudad, provincia, pais, lat, lng}`, `superficie {total_m2, cubierta_m2, terreno_m2}`, `ambientes`, `dormitorios`, `banos`, `cocheras`, `antiguedad`, `amenities[]`, `descripcion`, `caracteristicas[]`, `contacto {nombre, telefono, email}`, `imagenes[] {url, alt}`, `videos[] {url, tipo}`, `url_fuente`, `campos_faltantes[]`.

### B.4 Análisis de imagen (Agente 3)
`{ tipo_ambiente, descripcion_corta, calidad (1-5), orientacion_original, estrategia_extension ("ninguna"|"arriba_y_abajo"|"solo_arriba"|"solo_abajo"), prompt_extension, riesgos[], usable }`

### B.5 `edit-plan.json` (Agente 5)
```json
{
  "version": 1,
  "video": {"archivo": "02_media/video_grabado/trabajo.mp4", "duracion_s": 58.4, "fps": 30, "ancho": 1080, "alto": 1920},
  "salida": {"ancho": 1080, "alto": 1920, "fps": 30},
  "captions": {"fuente": "transcripcion.json", "grupo_palabras": [2, 4], "zona": "segura-inferior"},
  "overlays": [
    {"id": "t1", "tipo": "titulo", "inicio": 0.2, "fin": 2.7, "props": {"texto": "Finca Dos", "subtexto": "BARRIO PRIVADO"}},
    {"id": "c1", "tipo": "chip_amenity", "inicio": 3.55, "fin": 4.85, "props": {"texto": "Laguna", "icono": "lago"}},
    {"id": "fin", "tipo": "tarjeta_final", "inicio": 55.9, "fin": 58.4, "props": {"cta": "Coordiná tu visita", "contacto": true}}
  ],
  "inserts": [
    {"id": "i1", "imagen": "04_extendidas/img_003.png", "inicio": 12.0, "fin": 14.0, "modo": "pantalla_completa", "movimiento": "zoom_in_suave"}
  ],
  "vo": [],
  "musica": {"archivo": "plantilla/musica/pista_01.mp3", "volumen": 0.12, "ducking": true}
}
```
Tipos de overlay: `titulo`, `chip_amenity`, `lower_third`, `etiqueta`, `barra_progreso`, `precio`, `tarjeta_final`.

### B.6 `estilo.json` (Agente 6)
`{ nombre, paleta {primario, acento, fondo, texto}, tipografia {titulos, cuerpo, subtitulos}, subtitulos {posicion, tamano_rel, resaltado, animacion, contorno}, transiciones [{tipo, duracion_s}], ritmo {cortes_por_min}, easing {tipo, rigidez, amortiguacion}, motion_graphics [{patron, descripcion, posicion}], color {vineta, contraste}, imagenes {movimiento, duracion_media_s}, notas }`

---

## APÉNDICE C — Variables de entorno (`.env.example`)

```bash
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_IDS=123456789          # separados por coma
TELEGRAM_WEBHOOK_SECRET=                 # string aleatorio largo
TELEGRAM_WEBHOOK_PATH=                   # string aleatorio largo
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_API_ROOT=http://telegram-bot-api:8081   # vacío = API en la nube (solo desarrollo)

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_REFERER=https://tuagencia.com
OPENROUTER_TITLE=Bot Inmobiliaria
MODEL_EXTRACT=google/gemini-2.5-flash
MODEL_TEXT=anthropic/claude-sonnet-4.5
MODEL_VISION=google/gemini-2.5-flash
MODEL_IMAGE=google/gemini-2.5-flash-image
MODEL_TTS=openai/gpt-audio-mini
TTS_VOICE=alloy

# Sistema
DATA_DIR=/data
PORT=3000
NODE_ENV=production
MOCK=0
MAX_USD_PER_PROJECT=5
MAX_USD_PER_DAY=20
WHISPER_MODEL=medium
RENDER_CONCURRENCY=2

# Zernio (Fase 9)
ZERNIO_API_KEY=
```

---

## APÉNDICE D — Pruebas y control de calidad

| Nivel | Qué | Cómo |
|---|---|---|
| Unitarias | paths, manifest, cola, paste-back, parsers | `vitest`, sin red |
| Contrato | respuestas de OpenRouter (texto, visión, imagen, audio) | fixtures grabadas + modo MOCK |
| Integración | cada agente con 1 proyecto real chico | corrida manual, resultados en `docs/PRUEBA-E2E.md` |
| Visual | overlays y subtítulos | `remotion still` de fotogramas clave |
| Aceptación | ruta completa con un cliente real | tú revisas el video final |

**Checklist de seguridad:** lista blanca de IDs · `secret_token` del webhook · anti-SSRF en capturar/descargar · slugs saneados · sin secretos en logs ni en el repo · tope de gasto · límite de tamaño de descarga · no publicar sin confirmación.

**Legal/operativo:** usa solo fotos y datos de clientes que te autorizaron; revisa términos de los portales que scrapees; las imágenes extendidas con IA deben aprobarse una por una (no mostrar espacios que no existen).

---

## APÉNDICE E — Prompts de sistema de los agentes

### E.1 Extractor (Agente 1)
```
Eres un extractor de datos inmobiliarios. Recibes el HTML simplificado de la página de una propiedad.
Devuelve SOLO el JSON del esquema. Reglas: no inventes ni deduzcas datos que no estén escritos; si falta,
usa null y agrégalo a campos_faltantes. Precio con monto numérico y moneda (USD/ARS). Superficies en m².
De cada imagen entrega la URL de MAYOR resolución disponible (srcset, data-src, og:image), absoluta.
Ignora logos, íconos, banners, avatares y publicidad. Amenities como lista de strings cortos en español.
```

### E.2 Prompts de extensión (Agente 3)
```
Eres director de arte de publicidad inmobiliaria. Analizas UNA foto y preparas la instrucción para
extenderla a formato vertical 9:16 con un modelo de imagen generativa.
1) Clasifica el ambiente y escribe una descripción corta y factual (para el guionista).
2) Evalúa calidad 1-5 (nitidez, luz, encuadre) y marca usable=false si es borrosa, muy oscura o ilegible.
3) Decide la estrategia de extensión según orientación.
4) Escribe prompt_extension EN INGLÉS: describe qué continúa por ARRIBA y por ABAJO de forma natural y
   coherente con la luz, perspectiva, materiales y estilo existentes. Incluye SIEMPRE: "Keep the original
   photo completely unchanged in the center. Do not alter, move, add or remove any object, furniture, wall,
   window, building or person. Photorealistic, same lighting and color grading, no text, no watermark."
5) Lista riesgos (reflejos, personas, patentes, objetos cortados en el borde).
Nunca inventes habitaciones, vistas, amenities ni elementos que cambien lo que la propiedad ofrece.
```

### E.3 Guionista y plan de edición (Agente 5)
```
Eres editor de video y copywriter inmobiliario. Recibes: transcripción con tiempos por palabra, análisis
de escenas del video, datos de la propiedad, marca del cliente y descripciones de imágenes disponibles.
Produces un plan de edición JSON. Principios: el video real y la voz del presentador mandan; los gráficos
acompañan, no compiten. Cada overlay aparece cuando el tema se menciona o se ve (±0,3 s). Máximo 1 chip
visible a la vez salvo en la tarjeta final. Los inserts de imágenes refuerzan lo que se nombra (ej.: dice
"cocina" → insert de la cocina 1,5-2,5 s). Evita tapar la cara del presentador y la zona de subtítulos.
Usa solo datos presentes en propiedad.json o en la transcripción. Cierre con CTA del cliente. Responde
solo con el JSON del esquema.
```

### E.4 Analista de estilo (Agente 6a)
```
Eres analista de motion design. Recibes fotogramas ordenados de un video de referencia con su tiempo.
Describe de forma técnica y reproducible: paleta (hex aproximados), tipografías, estilo de subtítulos,
transiciones y duración, ritmo de cortes, tipos de gráficos animados y su posición, curvas de animación
(springs/ease), tratamiento de color y movimiento sobre imágenes. Sé concreto y mide proporciones
relativas al ancho del cuadro. Responde solo con el JSON del esquema estilo.json.
```

---

## APÉNDICE F — Orden de trabajo recomendado y entregables

| Fase | Entregable verificable |
|---|---|
| 0 | `ESTRUCTURA-REAL.md`, preguntas resueltas |
| 1 | Bot con whitelist, clientes reales, `/estado`, cola persistente |
| 2 | `/capturar` + `/imagenes` funcionando con 3 sitios reales |
| 3 | `/prompts` con edición desde Telegram |
| 4 | `/extender` con paste-back, aprobación por imagen y topes de costo |
| 5 | `/subir` + `/guion` (+ `/voz`) con plan de edición aprobable |
| 6 | `/estilos` + `/video` con borrador y render final |
| 7 | `/todo`, costos, cancelación, limpieza, E2E con MOCK |
| 8 | Despliegue en Dokploy con servidor Bot API local |
| 9 | `/publicar` con Zernio (opcional) |

**Regla de oro para Claude Code:** una fase a la vez, tests antes de seguir, commits pequeños, y cualquier desvío del instructivo se documenta en `docs/DECISIONES.md`.
