import { existsSync as fsSyncExists } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editPlanSchema, type EditPlan } from "../schemas/plan.js";
import type { Transcripcion } from "../lib/transcripcion.js";
import { run, probe } from "../lib/ffmpeg.js";
import { exists, readJson, writeJson } from "../lib/hash.js";
import { loadCliente } from "../project/cliente.js";
import { resolverEstilo } from "./6a-estilo.js";
import { AgentError, runAgent, type AgentContext, type AgentResult } from "./context.js";

export interface RenderOptions {
  propsFile: string;
  publicDir: string;
  out: string;
  /** 0.5 = borrador 540×960. */
  scale: number;
  crf: number;
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface VideoRenderer {
  render(o: RenderOptions): Promise<void>;
}

/** Busca my-video/ subiendo desde este archivo (funciona desde src/ y desde dist/). */
export function findRemotionDir(): string {
  if (process.env.REMOTION_DIR) return process.env.REMOTION_DIR;
  let d = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const c = path.join(d, "my-video");
    try {
      if (fsSyncExists(path.join(c, "package.json"))) return c;
    } catch {
      /* sigue subiendo */
    }
    d = path.dirname(d);
  }
  throw new Error("No encuentro la carpeta my-video/ (definí REMOTION_DIR)");
}

/** Render real con el CLI de Remotion (composición "Edicion" de my-video/). */
export class RemotionCliRenderer implements VideoRenderer {
  constructor(private cwd = findRemotionDir()) {}

  async render(o: RenderOptions): Promise<void> {
    const args = [
      "remotion", "render", "src/index.ts", "Edicion", o.out,
      `--props=${o.propsFile}`, `--public-dir=${o.publicDir}`, `--concurrency=${o.concurrency}`,
      `--scale=${o.scale}`, `--crf=${o.crf}`, "--codec=h264", "--pixel-format=yuv420p", "--color-space=bt709",
      "--audio-codec=aac", "--audio-bitrate=192k", "--log=info", "--overwrite",
    ];
    if (process.env.REMOTION_BROWSER_EXECUTABLE) args.push(`--browser-executable=${process.env.REMOTION_BROWSER_EXECUTABLE}`);
    const seen = (s: string) => {
      const m = [...s.matchAll(/Rendered\s+(\d+)\/(\d+)/g)].pop();
      if (m) o.onProgress?.(Number(m[1]) / Number(m[2]));
    };
    await run("npx", args, { cwd: this.cwd, signal: o.signal, onStderr: seen, onStdout: seen });
  }
}

/** Render de prueba sin Chromium: escala el video de entrada con ffmpeg (para tests y MOCK=1). */
export class MockRenderer implements VideoRenderer {
  async render(o: RenderOptions): Promise<void> {
    const props = (await readJson(o.propsFile)) as { plan: EditPlan };
    const w = Math.round(props.plan.salida.ancho * o.scale);
    const h = Math.round(props.plan.salida.alto * o.scale);
    await run("ffmpeg", ["-y", "-i", path.join(o.publicDir, props.plan.video.archivo), "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", o.out], { signal: o.signal });
    o.onProgress?.(1);
  }
}

async function enlazar(src: string, dst: string): Promise<void> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rm(dst, { force: true });
  try {
    await fs.link(src, dst);
  } catch {
    await fs.copyFile(src, dst);
  }
}

export async function video(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const final = ctx.args["final"] === true;
  const dirGuion = paths.subdir(cliente, slug, "guion");
  const planFile = path.join(dirGuion, "edit-plan.json");
  if (!(await exists(planFile))) throw new AgentError("Primero ejecutá /guion (no hay edit-plan.json).");
  const dirOut = paths.subdir(cliente, slug, "video");
  await fs.mkdir(dirOut, { recursive: true });
  const out = path.join(dirOut, final ? "final.mp4" : "borrador.mp4");

  return runAgent(ctx, "video", { hashEntrada: undefined, salidas: () => [`06_video/${final ? "final" : "borrador"}.mp4`] }, async () => {
    const plan = editPlanSchema.parse(await readJson(planFile));
    const cli = await loadCliente(paths, cliente);
    const estilo = await resolverEstilo(paths, cli, typeof ctx.args["estilo"] === "string" ? (ctx.args["estilo"] as string) : undefined);
    const trans = await readJson<Transcripcion>(path.join(dirGuion, "transcripcion.json")).catch(() => ({ idioma: "es", palabras: [] }) as Transcripcion);

    // ---- directorio público para Remotion: todo con nombres relativos y estables
    const pub = path.join(dirOut, "_public");
    await fs.rm(pub, { recursive: true, force: true });
    await fs.mkdir(pub, { recursive: true });
    try {
      const abs = (rel: string) => path.join(paths.proyectoDir(cliente, slug), rel);
      await enlazar(abs(plan.video.archivo), path.join(pub, "video.mp4"));
      const pplan: EditPlan = structuredClone(plan);
      pplan.video.archivo = "video.mp4";
      for (const i of pplan.inserts) {
        await enlazar(path.join(paths.subdir(cliente, slug, "extendidas"), i.imagen), path.join(pub, "inserts", i.imagen));
        i.imagen = `inserts/${i.imagen}`;
      }
      for (const v of pplan.vo) {
        if (!v.archivo) continue;
        const nombre = path.basename(v.archivo);
        await enlazar(abs(v.archivo), path.join(pub, "voz", nombre));
        v.archivo = `voz/${nombre}`;
      }
      if (pplan.musica.archivo) {
        const src = path.join(paths.root, pplan.musica.archivo);
        if (await exists(src)) {
          const nombre = `musica${path.extname(src)}`;
          await enlazar(src, path.join(pub, nombre));
          pplan.musica.archivo = nombre;
        } else pplan.musica.archivo = null;
      }
      let logo: string | null = null;
      if (cli.marca.logo) {
        const src = path.join(paths.clienteDir(cliente), cli.marca.logo);
        if (await exists(src)) {
          logo = `logo${path.extname(src)}`;
          await enlazar(src, path.join(pub, logo));
        }
      }
      // Fuentes: plantilla/fuentes/<Fuente>.(ttf|otf|woff2|woff)
      const fuentes: { nombre: string; archivo: string }[] = [];
      for (const nombre of new Set([estilo.tipografia.titulos, estilo.tipografia.cuerpo, estilo.tipografia.subtitulos])) {
        for (const ext of ["woff2", "woff", "ttf", "otf"]) {
          const src = path.join(paths.plantillaDir, "fuentes", `${nombre}.${ext}`);
          if (await exists(src)) {
            await enlazar(src, path.join(pub, "fonts", `${nombre}.${ext}`));
            fuentes.push({ nombre, archivo: `fonts/${nombre}.${ext}` });
            break;
          }
        }
      }
      const props = {
        plan: pplan,
        estilo,
        cliente: { nombre: cli.nombre, colores: cli.marca.colores, logo, contacto: cli.contacto, cta: cli.cta_por_defecto },
        palabras: trans.palabras,
        fuentes,
      };
      const propsFile = path.join(dirOut, "_props.json");
      await writeJson(propsFile, props);

      ctx.progress(final ? "🎬 Renderizando el video final…" : "🎬 Renderizando el borrador…");
      let ultimo = -1;
      await ctx.renderer.render({
        propsFile,
        publicDir: pub,
        out,
        scale: final ? 1 : 0.5,
        crf: final ? 18 : 28,
        concurrency: ctx.config.RENDER_CONCURRENCY,
        signal: ctx.signal,
        onProgress: (p) => {
          const pct = Math.floor(p * 10) * 10;
          if (pct !== ultimo) {
            ultimo = pct;
            ctx.progress(`🎬 Renderizando ${final ? "final" : "borrador"}… ${pct}%`);
          }
        },
      });
      await fs.rm(propsFile, { force: true });
    } finally {
      await fs.rm(pub, { recursive: true, force: true });
    }

    const st = await fs.stat(out);
    const info = await probe(out);
    if (final) await run("ffmpeg", ["-y", "-ss", "1", "-i", out, "-frames:v", "1", "-q:v", "3", path.join(dirOut, "thumbnail.jpg")], { signal: ctx.signal }).catch(() => undefined);
    const mb = (st.size / 1024 / 1024).toFixed(1);
    return final
      ? {
          texto: `✅ Video final listo: ${info.ancho}×${info.alto}, ${info.duracion_s.toFixed(0)} s, ${mb} MB (estilo "${estilo.nombre}").`,
          media: [{ path: out, tipo: "video" }],
          botones: [[{ texto: "📣 Publicar (/publicar)", data: "next:publicar" }]],
        }
      : {
          texto: `✅ Borrador listo (${info.ancho}×${info.alto}, ${mb} MB, estilo "${estilo.nombre}"). Si está bien, renderizá el final.`,
          media: [{ path: out, tipo: "video" }],
          botones: [[{ texto: "✅ Aprobar y renderizar final", data: "vf:final" }], [{ texto: "✏️ Pedir cambios al plan", data: "pl:cambios" }]],
        };
  });
}

