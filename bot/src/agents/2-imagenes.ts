import fs from "node:fs/promises";
import path from "node:path";
import { propiedadSchema, imagenIndiceSchema, type ImagenIndice } from "../schemas/propiedad.js";
import { descarteMotivo, dhash, hamming, inspect, orientacion, toJpeg } from "../lib/imagen.js";
import { hashFiles, readJson, writeJson } from "../lib/hash.js";
import { safeFetch, withRetries } from "../lib/net.js";
import { loadCliente } from "../project/cliente.js";
import { run } from "../lib/ffmpeg.js";
import { AgentError, pool, runAgent, type AgentContext, type AgentResult } from "./context.js";

const MAX_BYTES = 25 * 1024 * 1024;
const DUP_DIST = 4;

interface Descargada {
  url: string;
  jpg: Buffer;
  width: number;
  height: number;
  hash: string;
}

export async function imagenes(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const propFile = paths.file(cliente, slug, "datos", "propiedad.json");
  return runAgent(
    ctx,
    "imagenes",
    {
      hashEntrada: await hashFiles([propFile]),
      salidas: () => ["02_media/originales/indice.json"],
    },
    async () => {
      const prop = propiedadSchema.parse(await readJson(propFile));
      if (prop.imagenes.length === 0) throw new AgentError("La propiedad no tiene imágenes para descargar.");

      const descartadas: { url: string; motivo: string }[] = [];
      let hechas = 0;
      const resultados = await pool(prop.imagenes, 4, async (img): Promise<Descargada | null> => {
        try {
          const r = await withRetries((i) => safeFetch(img.url, { maxBytes: MAX_BYTES, timeoutMs: 60_000, signal: ctx.signal, headers: i ? { accept: "image/*" } : {} }), 3, 500, ctx.signal);
          if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
          const meta = await inspect(r.body);
          const motivo = descarteMotivo(meta.width, meta.height, r.body.length);
          if (motivo) {
            descartadas.push({ url: img.url, motivo });
            return null;
          }
          const jpg = await toJpeg(r.body);
          const m2 = await inspect(jpg);
          return { url: img.url, jpg, width: m2.width, height: m2.height, hash: await dhash(jpg) };
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          descartadas.push({ url: img.url, motivo: e instanceof Error ? e.message.slice(0, 120) : "error" });
          return null;
        } finally {
          ctx.progress(`⬇️ Imágenes ${++hechas}/${prop.imagenes.length}`);
        }
      });

      // Deduplicado: se conserva la de mayor resolución dentro de cada grupo de hashes cercanos.
      const orden = resultados.map((r, i) => ({ r, i })).filter((x): x is { r: Descargada; i: number } => x.r !== null);
      const descartarIdx = new Set<number>();
      for (let a = 0; a < orden.length; a++) {
        for (let b = a + 1; b < orden.length; b++) {
          const A = orden[a]!;
          const B = orden[b]!;
          if (descartarIdx.has(A.i) || descartarIdx.has(B.i)) continue;
          if (hamming(A.r.hash, B.r.hash) <= DUP_DIST) {
            const perdedor = A.r.width * A.r.height >= B.r.width * B.r.height ? B : A;
            descartarIdx.add(perdedor.i);
            descartadas.push({ url: perdedor.r.url, motivo: "duplicada" });
          }
        }
      }
      const finales = orden.filter((x) => !descartarIdx.has(x.i)).map((x) => x.r);

      const dir = paths.subdir(cliente, slug, "originales");
      await fs.mkdir(dir, { recursive: true });
      for (const f of await fs.readdir(dir)) if (/^img_\d+\.jpg$/.test(f)) await fs.rm(path.join(dir, f)); // re-ejecución limpia
      const indice: ImagenIndice = { version: 1, imagenes: [], descartadas };
      for (const [n, d] of finales.entries()) {
        const archivo = `img_${String(n + 1).padStart(3, "0")}.jpg`;
        await fs.writeFile(path.join(dir, archivo), d.jpg);
        indice.imagenes.push({ archivo, ancho: d.width, alto: d.height, orientacion: orientacion(d.width, d.height), url: d.url, hash: d.hash });
      }
      await writeJson(path.join(dir, "indice.json"), imagenIndiceSchema.parse(indice));
      if (finales.length === 0) throw new AgentError(`No quedó ninguna imagen utilizable (${descartadas.length} descartadas).`);

      const videoMsg = await descargarVideo(ctx, prop.videos);

      const motivos = [...new Set(descartadas.map((d) => d.motivo.replace(/\(.*\)/, "").trim()))].slice(0, 4).join(", ");
      return {
        texto: [`✅ ${finales.length} imágenes descargadas · ${descartadas.length} descartadas${motivos ? ` (${motivos})` : ""}`, videoMsg].filter(Boolean).join("\n"),
        media: finales.slice(0, 10).map((d, i) => ({ path: path.join(dir, `img_${String(i + 1).padStart(3, "0")}.jpg`), tipo: "foto" as const })),
        botones: [[{ texto: "➡️ Generar prompts (/prompts)", data: "next:prompts" }]],
      };
    },
  );
}

/** mp4 directo siempre; YouTube/Vimeo solo con yt-dlp y autorización del cliente. */
async function descargarVideo(ctx: AgentContext, videos: { url: string; tipo: string }[]): Promise<string> {
  if (videos.length === 0) return "";
  const dir = ctx.paths.subdir(ctx.cliente, ctx.slug, "media");
  const mp4 = videos.find((v) => v.tipo === "mp4");
  if (mp4) {
    try {
      const r = await safeFetch(mp4.url, { maxBytes: 500 * 1024 * 1024, timeoutMs: 300_000, signal: ctx.signal });
      if (r.status < 400 && r.body.length > 10_000) {
        await fs.writeFile(path.join(dir, "video_web.mp4"), r.body);
        return "🎬 Video de la web descargado (video_web.mp4).";
      }
    } catch (e) {
      if (ctx.signal.aborted) throw e;
    }
    return "⚠️ No pude descargar el video mp4 de la web.";
  }
  const embed = videos.find((v) => v.tipo === "youtube" || v.tipo === "vimeo");
  if (!embed) return "";
  const c = await loadCliente(ctx.paths, ctx.cliente);
  if (!c.permite_descargar_video_embed) return `ℹ️ Hay un video ${embed.tipo} embebido (no se descarga: el cliente no lo autorizó).`;
  try {
    await run("yt-dlp", ["-f", "mp4/best", "--no-playlist", "-o", path.join(dir, "video_web.%(ext)s"), embed.url], { signal: ctx.signal });
    return `🎬 Video de ${embed.tipo} descargado.`;
  } catch {
    return `⚠️ No pude descargar el video de ${embed.tipo} (¿yt-dlp instalado?).`;
  }
}
