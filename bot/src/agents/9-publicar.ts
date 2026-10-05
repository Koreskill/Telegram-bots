import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { propiedadSchema } from "../schemas/propiedad.js";
import { probe } from "../lib/ffmpeg.js";
import { exists, readJson } from "../lib/hash.js";
import { loadCliente } from "../project/cliente.js";
import { setAgente } from "../project/manifest.js";
import { skillPrompt } from "../skills.js";
import { AgentError, type AgentContext, type AgentResult } from "./context.js";

export interface PublishRequest {
  videoPath: string;
  caption: string;
  cuentas: { plataforma: string; accountId: string }[];
  modo: "ahora" | "borrador" | "programar";
  /** ISO 8601 (solo modo "programar"). */
  programarPara?: string;
  timezone?: string;
  signal?: AbortSignal;
}
export interface PublishResult {
  postId: string;
  estado: string;
  urls: string[];
}
export interface Publisher {
  publicar(r: PublishRequest): Promise<PublishResult>;
}

const presignSchema = z.object({ uploadUrl: z.string().url(), publicUrl: z.string().url() });
const postSchema = z.object({
  post: z.object({ _id: z.string(), status: z.string().default("created"), platforms: z.array(z.object({ platformPostUrl: z.string().optional() }).passthrough()).default([]) }).passthrough(),
});

/**
 * Zernio (https://docs.zernio.com): POST /media/presign → PUT al uploadUrl → POST /posts.
 * Borrador = sin fecha ni publishNow; programado = scheduledFor + timezone; ahora = publishNow:true.
 */
export class ZernioPublisher implements Publisher {
  constructor(
    private apiKey: string,
    private base = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async api(pathname: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${pathname}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Zernio ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  async publicar(r: PublishRequest): Promise<PublishResult> {
    if (!this.apiKey) throw new AgentError("Falta ZERNIO_API_KEY");
    const size = (await fs.stat(r.videoPath)).size;
    const filename = path.basename(r.videoPath);
    const pre = presignSchema.parse(await this.api("/media/presign", { filename, contentType: "video/mp4", size }, r.signal));
    const put = await this.fetchImpl(pre.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: Readable.toWeb(createReadStream(r.videoPath)) as unknown as BodyInit,
      // @ts-expect-error `duplex` es requerido por undici para cuerpos en streaming
      duplex: "half",
      signal: r.signal,
    });
    if (!put.ok) throw new Error(`La subida del video falló (${put.status})`);

    const body: Record<string, unknown> = {
      content: r.caption,
      mediaItems: [{ type: "video", url: pre.publicUrl }],
      platforms: r.cuentas.map((c) => ({ platform: c.plataforma, accountId: c.accountId, ...(c.plataforma === "instagram" ? { platformSpecificData: { shareToFeed: true } } : {}) })),
    };
    if (r.modo === "ahora") body["publishNow"] = true;
    if (r.modo === "programar") {
      if (!r.programarPara) throw new AgentError("Falta la fecha para programar");
      body["scheduledFor"] = r.programarPara;
      body["timezone"] = r.timezone ?? "America/Argentina/Buenos_Aires";
    }
    const res = postSchema.parse(await this.api("/posts", body, r.signal));
    return { postId: res.post._id, estado: res.post.status, urls: res.post.platforms.map((p) => p.platformPostUrl).filter((u): u is string => !!u) };
  }
}

/** Publicador deshabilitado (sin ZERNIO_API_KEY): falla con un mensaje claro. */
export class NoPublisher implements Publisher {
  async publicar(): Promise<PublishResult> {
    throw new AgentError("Zernio no está configurado: definí ZERNIO_API_KEY y las cuentas en cliente.json (zernio.cuentas).");
  }
}

const copySchema = z.object({ caption: z.string().min(1) });
export const copyFile = (ctx: Pick<AgentContext, "paths" | "cliente" | "slug">) => path.join(ctx.paths.subdir(ctx.cliente, ctx.slug, "video"), "copy.txt");

/** Paso 1: genera el copy y muestra la vista previa. No publica nada. */
export async function publicar(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const videoPath = path.join(paths.subdir(cliente, slug, "video"), "final.mp4");
  if (!(await exists(videoPath))) throw new AgentError("Todavía no hay video final: ejecutá /video y aprobá el render final.");
  const cli = await loadCliente(paths, cliente);
  if (cli.zernio.cuentas.length === 0) throw new AgentError(`El cliente "${cli.nombre}" no tiene cuentas de Zernio en cliente.json (zernio.cuentas).`);
  const prop = propiedadSchema.parse(await readJson(paths.file(cliente, slug, "datos", "propiedad.json")));

  let caption = typeof ctx.args["caption"] === "string" ? (ctx.args["caption"] as string) : "";
  if (!caption) {
    await ctx.assertBudget();
    const { data, costUsd } = await ctx.llm.json({
      model: ctx.config.MODEL_TEXT,
      system: skillPrompt("publicar", "copy", { tono: cli.tono, idioma: cli.idioma, cta: cli.cta_por_defecto }),
      user: `DATOS: ${JSON.stringify({ titulo: prop.titulo, tipo: prop.tipo_propiedad, operacion: prop.tipo_operacion, precio: prop.precio, ubicacion: prop.ubicacion, superficie: prop.superficie, ambientes: prop.ambientes, dormitorios: prop.dormitorios, amenities: prop.amenities })}\nCONTACTO: ${JSON.stringify(cli.contacto)}`,
      name: "copy_social",
      schema: copySchema,
      signal: ctx.signal,
      mock: () => ({ caption: `${prop.titulo ?? "Nueva propiedad"} ✨\n\n${cli.cta_por_defecto}\n\n#inmobiliaria #propiedades` }),
    });
    ctx.spend(costUsd);
    caption = data.caption;
  }
  await fs.writeFile(copyFile(ctx), caption);
  const info = await probe(videoPath);
  const avisos = cli.zernio.cuentas.some((c) => c.plataforma === "instagram") && info.duracion_s > 90 ? "\n⚠️ Instagram Reels admite hasta 90 s: este video dura más." : "";
  return {
    texto: `📣 Vista previa de la publicación\nCuentas: ${cli.zernio.cuentas.map((c) => c.plataforma).join(", ")}\n\n${caption}${avisos}\n\n⚠️ No se publica nada hasta que confirmes.`,
    botones: [
      [{ texto: "🚀 Publicar ahora", data: "pub:ahora" }, { texto: "📝 Guardar borrador", data: "pub:borrador" }],
      [{ texto: "🗓 Programar", data: "pub:prog" }, { texto: "✏️ Editar texto", data: "pub:edit" }],
      [{ texto: "✖️ Cancelar", data: "pub:cancel" }],
    ],
  };
}

/** Paso 2: ejecuta la publicación (solo se llama tras una confirmación explícita del usuario). */
export async function ejecutarPublicacion(ctx: AgentContext, modo: PublishRequest["modo"], programarPara?: string): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const cli = await loadCliente(paths, cliente);
  const caption = await fs.readFile(copyFile(ctx), "utf8");
  await setAgente(paths, cliente, slug, "publicar", { estado: "running", inicio: new Date().toISOString() });
  try {
    const r = await ctx.publisher.publicar({
      videoPath: path.join(paths.subdir(cliente, slug, "video"), "final.mp4"),
      caption,
      cuentas: cli.zernio.cuentas,
      modo,
      programarPara,
      signal: ctx.signal,
    });
    await setAgente(paths, cliente, slug, "publicar", { estado: "done", fin: new Date().toISOString(), salidas: [`zernio:${r.postId}`], mensaje: `${modo}: ${r.estado}`, post_id: r.postId });
    const etiqueta = { ahora: "Publicado", borrador: "Guardado como borrador", programar: `Programado para ${programarPara}` }[modo];
    return { texto: `✅ ${etiqueta} (post ${r.postId}, estado ${r.estado}).${r.urls.length ? `\n${r.urls.join("\n")}` : ""}` };
  } catch (e) {
    await setAgente(paths, cliente, slug, "publicar", { estado: "error", fin: new Date().toISOString(), mensaje: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    throw e;
  }
}
