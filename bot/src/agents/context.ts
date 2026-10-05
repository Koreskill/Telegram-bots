import type { Config } from "../config.js";
import type { Paths } from "../paths.js";
import type { Llm } from "../llm/types.js";
import type { PageFetcher } from "../lib/browser.js";
import type { Transcriber } from "../lib/whisper.js";
import type { JobStore } from "../queue/queue.js";
import { readManifest, setAgente, type AgenteId } from "../project/manifest.js";
import type { Publisher } from "./9-publicar.js";
import type { VideoRenderer } from "./6-video.js";

export interface Boton {
  texto: string;
  /** callback_data (<= 64 bytes). */
  data: string;
}

export interface AgentResult {
  texto: string;
  /** Imágenes/videos/audios a enviar (con botones opcionales por elemento). */
  media?: { path: string; tipo?: "foto" | "documento" | "video" | "audio"; caption?: string; botones?: Boton[][] }[];
  botones?: Boton[][];
}

export interface AgentDeps {
  config: Config;
  paths: Paths;
  llm: Llm;
  store: JobStore;
  fetcher: PageFetcher;
  transcriber: Transcriber;
  renderer: VideoRenderer;
  publisher: Publisher;
}

export interface AgentContext extends AgentDeps {
  cliente: string;
  slug: string;
  signal: AbortSignal;
  /** Argumentos del comando (flags ya parseadas). */
  args: Record<string, unknown>;
  progress(text: string): void;
  /** Verifica los topes ANTES de una llamada de pago. */
  assertBudget(): Promise<void>;
  /** Registra el gasto de una llamada (proyecto y día). */
  spend(usd: number): void;
  /** Gasto acumulado en esta ejecución. */
  readonly gasto: number;
}

export class BudgetError extends Error {}
export class AgentError extends Error {}

export function makeContext(
  deps: AgentDeps,
  o: { cliente: string; slug: string; signal: AbortSignal; args?: Record<string, unknown>; progress?: (t: string) => void },
): AgentContext {
  let gasto = 0;
  return {
    ...deps,
    cliente: o.cliente,
    slug: o.slug,
    signal: o.signal,
    args: o.args ?? {},
    progress: o.progress ?? (() => undefined),
    get gasto() {
      return gasto;
    },
    async assertBudget() {
      o.signal.throwIfAborted();
      // Sin proyecto todavía (capturar, estilos) solo cuenta el gasto de esta ejecución.
      const m = o.slug ? await readManifest(deps.paths, o.cliente, o.slug).catch(() => undefined) : undefined;
      const proyecto = (m?.costo_total_usd ?? 0) + gasto;
      if (proyecto >= deps.config.MAX_USD_PER_PROJECT)
        throw new BudgetError(`Se alcanzó el tope por proyecto ($${deps.config.MAX_USD_PER_PROJECT}). Gastado: $${proyecto.toFixed(3)}.`);
      if (deps.store.spentToday() >= deps.config.MAX_USD_PER_DAY)
        throw new BudgetError(`Se alcanzó el tope diario ($${deps.config.MAX_USD_PER_DAY}).`);
    },
    spend(usd) {
      gasto += usd;
      deps.store.addSpend(usd);
    },
  };
}

/**
 * Envuelve la ejecución de un agente: marca running/done/error en el manifest, suma costos y
 * saltea el trabajo si las entradas no cambiaron (idempotencia), salvo `--forzar`.
 */
export async function runAgent(
  ctx: AgentContext,
  id: AgenteId,
  o: { hashEntrada?: string; salidas?: () => string[] | Promise<string[]>; yaHecho?: string },
  fn: () => Promise<AgentResult>,
): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const m = await readManifest(paths, cliente, slug);
  const prev = m.agentes[id];
  if (!ctx.args["forzar"] && prev.estado === "done" && o.hashEntrada && prev.hash_entrada === o.hashEntrada) {
    return { texto: o.yaHecho ?? `✅ ${id} ya estaba hecho con estas mismas entradas. Usá --forzar para rehacerlo.` };
  }
  await setAgente(paths, cliente, slug, id, { estado: "running", inicio: new Date().toISOString(), fin: undefined, mensaje: undefined });
  try {
    const r = await fn();
    await setAgente(paths, cliente, slug, id, {
      estado: "done",
      fin: new Date().toISOString(),
      salidas: o.salidas ? await o.salidas() : prev.salidas,
      costo_usd: Number(((prev.costo_usd ?? 0) + ctx.gasto).toFixed(6)),
      hash_entrada: o.hashEntrada,
      mensaje: undefined,
    });
    return r;
  } catch (e) {
    const abortado = ctx.signal.aborted;
    await setAgente(paths, cliente, slug, id, {
      estado: abortado ? "pending" : "error",
      fin: new Date().toISOString(),
      costo_usd: Number(((prev.costo_usd ?? 0) + ctx.gasto).toFixed(6)),
      mensaje: abortado ? "cancelado" : e instanceof Error ? e.message.slice(0, 500) : String(e),
    });
    throw e;
  }
}

/** Ejecuta `fn` sobre `items` con concurrencia limitada, preservando el orden de resultados. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
