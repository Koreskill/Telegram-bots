import type { JobClass, Job, JobStore, Worker } from "../queue/queue.js";
import type { Paths } from "../paths.js";
import { readManifest, type AgenteId } from "../project/manifest.js";
import type { Sender } from "../telegram/send.js";
import { BudgetError, makeContext, type AgentContext, type AgentDeps, type AgentResult } from "./context.js";
import { capturar } from "./1-capturar.js";
import { imagenes } from "./2-imagenes.js";
import { prompts } from "./3-prompts.js";
import { extender } from "./4-extender.js";
import { guion } from "./5-guion.js";
import { voz } from "./5b-voz.js";
import { estilos } from "./6a-estilo.js";
import { video } from "./6-video.js";
import { ejecutarPublicacion, publicar } from "./9-publicar.js";

export type AgentJob = "capturar" | "imagenes" | "prompts" | "extender" | "guion" | "voz" | "estilos" | "video" | "publicar" | "publicar_ejecutar";

export const CLASE: Record<AgentJob, JobClass> = {
  capturar: "light",
  imagenes: "light",
  prompts: "light",
  extender: "heavy",
  guion: "heavy",
  voz: "heavy",
  estilos: "heavy",
  video: "heavy",
  publicar: "light",
  publicar_ejecutar: "light",
};

/** Orden de la ruta y el agente que se sugiere después de cada uno. */
export const SIGUIENTE: Partial<Record<AgentJob, AgentJob>> = {
  capturar: "imagenes",
  imagenes: "prompts",
  prompts: "extender",
  extender: "guion",
  guion: "video",
  video: "publicar",
};
/** Con /todo (manifest.auto) se encadenan solos estos pasos; el resto exige aprobación humana. */
export const AUTO_ENCADENA: AgentJob[] = ["capturar", "imagenes"];

export const esAgente = (s: string): s is AgentJob => s in CLASE;

export function enqueueAgent(
  store: JobStore,
  o: { tipo: AgentJob; chatId: number | null; cliente: string | null; proyecto: string | null; args?: Record<string, unknown> },
): Job {
  return store.enqueue({ tipo: o.tipo, clase: CLASE[o.tipo], chatId: o.chatId, cliente: o.cliente, proyecto: o.proyecto, payload: { args: o.args ?? {} } });
}

const MENSAJE_INICIAL: Record<AgentJob, string> = {
  capturar: "⏳ Capturando la propiedad…",
  imagenes: "⏳ Descargando imágenes…",
  prompts: "⏳ Generando prompts de extensión…",
  extender: "⏳ Extendiendo imágenes…",
  guion: "⏳ Preparando el guion y el plan de edición…",
  voz: "⏳ Generando voz en off…",
  estilos: "⏳ Analizando estilos de plantilla…",
  video: "⏳ Preparando el render…",
  publicar: "⏳ Preparando la publicación…",
  publicar_ejecutar: "⏳ Publicando…",
};

/** Registra en el worker un handler por cada agente: contexto → ejecución → resultado a Telegram. */
export function registerAgents(worker: Worker, deps: AgentDeps, store: JobStore, paths: Paths, sender: Sender): void {
  const handlers: Record<AgentJob, (ctx: AgentContext, job: Job) => Promise<AgentResult & { slug?: string }>> = {
    capturar: (ctx, job) => capturar(ctx, String((job.payload["args"] as { url: string }).url)),
    imagenes: (ctx) => imagenes(ctx),
    prompts: (ctx) => prompts(ctx),
    extender: (ctx) => extender(ctx),
    guion: (ctx) => guion(ctx),
    voz: (ctx) => voz(ctx),
    estilos: (ctx) => estilos(ctx),
    video: (ctx) => video(ctx),
    publicar: (ctx) => publicar(ctx),
    publicar_ejecutar: (ctx, job) => {
      const a = job.payload["args"] as { modo: "ahora" | "borrador" | "programar"; fecha?: string };
      return ejecutarPublicacion(ctx, a.modo, a.fecha);
    },
  };

  for (const tipo of Object.keys(handlers) as AgentJob[]) {
    worker.register(tipo, async (job, { signal }) => {
      const chat = job.chat_id;
      const prog = chat ? await sender.progress(chat, MENSAJE_INICIAL[tipo]) : undefined;
      const ctx = makeContext(deps, {
        cliente: job.cliente ?? "",
        slug: job.proyecto ?? "",
        signal,
        args: (job.payload["args"] ?? {}) as Record<string, unknown>,
        progress: (t) => prog?.update(t),
      });
      let r: AgentResult & { slug?: string };
      try {
        r = await handlers[tipo](ctx, job);
      } catch (e) {
        await prog?.finish(signal.aborted ? "🛑 Cancelado." : `❌ ${tipo} falló.`);
        if (e instanceof BudgetError && chat) await sender.text(chat, `⛔ ${e.message}`);
        throw e;
      }
      await prog?.finish(`✅ ${tipo} terminado.`);
      const slug = r.slug ?? job.proyecto;
      if (tipo === "capturar" && chat && r.slug) store.setChatState(chat, { cliente: job.cliente, proyecto: r.slug });
      if (chat) await sender.result(chat, r);

      // /todo: encadenado automático hasta el primer punto de aprobación.
      const sig = SIGUIENTE[tipo];
      if (chat && sig && AUTO_ENCADENA.includes(tipo) && job.cliente && slug) {
        const m = await readManifest(paths, job.cliente, slug).catch(() => undefined);
        if (m?.auto) enqueueAgent(store, { tipo: sig, chatId: chat, cliente: job.cliente, proyecto: slug });
      }
    });
  }
}

export type { AgenteId };
