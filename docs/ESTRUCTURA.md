# Estructura de datos: clientes y propiedades

Todo lo que el bot lee y escribe vive en **un solo volumen**, `DATA_DIR` (`/data` en producción).
El código accede a las rutas **solo** a través de `bot/src/paths.ts`. En `datos-ejemplo/` hay una copia
mínima; `npm run init-data` la crea en `DATA_DIR` sin pisar nada existente.

```
DATA_DIR/
├── bot.sqlite                          cola de trabajos, cliente/proyecto activo, gasto diario
├── whisper/                            (si WHISPER_DIR no está definido) whisper.cpp + modelo
├── clientes/
│   └── <Cliente>/                      ← una carpeta por inmobiliaria (se crea con /nuevocliente)
│       ├── cliente.json                marca, contacto, tono, CTA, estilo, voz, cuentas de Zernio
│       ├── logo.png                    (opcional) el que indique marca.logo
│       └── proyectos/
│           └── <slug-propiedad>/       ← UNA carpeta por propiedad (la crea /capturar)
│               ├── manifest.json       estado, costos y salidas de cada agente
│               ├── 01_datos/           propiedad.json · pagina.html · captura.jpg
│               ├── 02_media/
│               │   ├── originales/     img_001.jpg … · indice.json   (Agente 2)
│               │   ├── video_grabado/  original.mp4 (/subir) · trabajo.mp4 (normalizado)
│               │   └── video_web.mp4   (si la web tenía un mp4 directo)
│               ├── 03_prompts/         img_001.json … · resumen.md   (Agente 3)
│               ├── 04_extendidas/      img_001.png (1080×1920) … · estado.json   (Agente 4)
│               ├── 05_guion/           transcripcion.json · transcripcion_original.json ·
│               │                       subtitulos.srt · analisis.json · guion.md · edit-plan.json
│               │   └── voz/            vo_001.wav …                  (Agente 5b, opcional)
│               └── 06_video/           borrador.mp4 · final.mp4 · thumbnail.jpg · copy.txt
└── plantilla/                          ← compartida por todos los clientes
    ├── estilos/<nombre>/               referencia.mp4 + estilo.json (lo genera /estilos)
    ├── fuentes/                        <Familia>.woff2|ttf|otf
    ├── musica/                         pistas de fondo (mp3/m4a/wav)
    └── logos/                          (reservado)
```

El **slug** de la propiedad se arma con barrio/ciudad + tipo + título (`finca-dos-casa-casa-en-finca-dos`)
y es único dentro del cliente (`-2`, `-3`… si se repite). Nombres de cliente/proyecto: letras, números,
espacios, `.`, `_`, `-`; nunca `..`, barras ni punto inicial.

## `cliente.json`

Todos los campos son opcionales: un cliente "mínimo" (solo la carpeta) ya funciona con los valores por defecto.

| Campo | Para qué sirve | Defecto |
|---|---|---|
| `nombre` | nombre visible; tarjeta final y copy | nombre de la carpeta |
| `marca.colores.{primario,acento,texto}` | paleta si no hay `estilo.json` | `#0d2b1e` / `#b8f04a` / `#ffffff` |
| `marca.fuente` | familia tipográfica (se busca en `plantilla/fuentes/`) | `Inter` |
| `marca.logo` | ruta del logo relativa a la carpeta del cliente | `null` |
| `contacto.{telefono,whatsapp,web,instagram,email}` | tarjeta final del video | vacío |
| `tono`, `idioma` | guion, corrección de subtítulos, voz y copy | cálido/profesional · `es-AR` |
| `cta_por_defecto` | llamada a la acción | `Coordiná tu visita` |
| `permite_descargar_video_embed` | permite bajar YouTube/Vimeo de la web del cliente | `false` |
| `estilo_por_defecto` | carpeta de `plantilla/estilos/` a usar | primer estilo analizado |
| `voz.{voice,instrucciones}` | voz de la voz en off | `TTS_VOICE` |
| `zernio.cuentas[]` | `{plataforma, accountId}` para `/publicar` | `[]` |

## `manifest.json` (por propiedad)

```json
{
  "version": 1, "cliente": "Cliente Ejemplo", "slug": "finca-dos-casa", "url_origen": "https://…",
  "creado": "2026-10-05T12:00:00Z", "auto": false,
  "agentes": {
    "capturar": { "estado": "done", "inicio": "…", "fin": "…", "salidas": ["01_datos/propiedad.json"], "costo_usd": 0.002, "hash_entrada": "…" },
    "imagenes": {}, "prompts": {}, "extender": { "aprobadas": ["img_001"] },
    "guion": {}, "voz": {}, "video": {}, "publicar": { "post_id": "…" }
  },
  "costo_total_usd": 0.31
}
```
Estados: `pending | running | done | error | skipped`. `hash_entrada` permite que un agente **no rehaga** lo
que ya está hecho con las mismas entradas (se fuerza con `--forzar`). `auto` lo activa `/todo`.

## `propiedad.json` (Agente 1)

`titulo`, `tipo_operacion`, `tipo_propiedad`, `precio{monto,moneda}`, `expensas`, `ubicacion{direccion,barrio,ciudad,provincia,pais}`,
`superficie{total_m2,cubierta_m2,terreno_m2}`, `ambientes`, `dormitorios`, `banos`, `cocheras`, `antiguedad`, `amenities[]`,
`caracteristicas[]`, `descripcion`, `contacto`, `imagenes[{url,alt}]`, `videos[{url,tipo}]`, `url_fuente`,
`campos_faltantes[]`, `capturado`. Lo que no está en la página es `null`: **nunca se inventa**.

## `edit-plan.json` (Agente 5 → 6)

`video` (archivo y medidas), `salida` (1080×1920, 30 fps, `extension_final_s`), `captions`, `overlays[]`
(`titulo | chip_amenity | lower_third | etiqueta | precio | barra_progreso | tarjeta_final`), `inserts[]`
(imagen de `04_extendidas/`, modo, movimiento), `vo[]`, `musica`, `guion`. Se valida con zod y se **repara
de forma determinista** (tiempos en rango, un solo chip a la vez, inserts sin solaparse y ≤ 40 % del video,
tarjeta final garantizada).

## `plantilla/estilos/<nombre>/estilo.json`

Paleta, tipografías, subtítulos (posición, tamaño, resaltado, animación, contorno, mayúsculas), transiciones,
ritmo, easing (rigidez/amortiguación), patrones de motion graphics, viñeta/contraste y movimiento de imágenes.
Lo genera `/estilos` a partir de `referencia.mp4`; **se puede editar a mano y ese valor manda**.
