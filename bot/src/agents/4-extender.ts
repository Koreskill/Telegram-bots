import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { imagenIndiceSchema } from "../schemas/propiedad.js";
import { blurFill, centroConservado, esVertical916, normalizeVertical, pasteBack } from "../lib/imagen.js";
import { exists, hashFiles, readJson, writeJson } from "../lib/hash.js";
import { skillPrompt } from "../skills.js";
import { updateManifest } from "../project/manifest.js";
import { AgentError, BudgetError, pool, runAgent, type AgentContext, type AgentResult, type Boton } from "./context.js";
import type { PromptImagen } from "./3-prompts.js";

export type MetodoExtension = "ia" | "blur" | "original";
export interface EstadoImagen {
  estado: "pendiente" | "aprobada" | "revisar";
  metodo: MetodoExtension;
  nota?: string;
}
export type EstadoExtendidas = Record<string, EstadoImagen>;

const UMBRAL_CENTRO = 8; // diferencia media (0-255) tolerada en la zona conservada

const estadoFile = (ctx: Pick<AgentContext, "paths" | "cliente" | "slug">) => path.join(ctx.paths.subdir(ctx.cliente, ctx.slug, "extendidas"), "estado.json");

export async function leerEstado(ctx: Pick<AgentContext, "paths" | "cliente" | "slug">): Promise<EstadoExtendidas> {
  try {
    return await readJson<EstadoExtendidas>(estadoFile(ctx));
  } catch {
    return {};
  }
}

/** Cadena de escrituras para que dos imágenes en paralelo no se pisen estado.json. */
function estadoWriter(ctx: AgentContext, inicial: EstadoExtendidas) {
  let chain: Promise<unknown> = Promise.resolve();
  const estado = inicial;
  return {
    estado,
    set(nombre: string, e: EstadoImagen) {
      estado[nombre] = e;
      chain = chain.then(() => writeJson(estadoFile(ctx), estado));
      return chain;
    },
    flush: () => chain,
  };
}

export async function extender(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const dirOrig = paths.subdir(cliente, slug, "originales");
  const dirPrompts = paths.subdir(cliente, slug, "prompts");
  const dirOut = paths.subdir(cliente, slug, "extendidas");
  const indiceFile = path.join(dirOrig, "indice.json");
  if (!(await exists(indiceFile))) throw new AgentError("Primero ejecutá /imagenes.");
  const solo = ctx.args["solo"] as string[] | undefined; // regenerar imágenes puntuales
  const forzarBlur = ctx.args["blur"] === true;
  const ajuste = typeof ctx.args["ajuste"] === "string" ? (ctx.args["ajuste"] as string) : "";

  const hash = await hashFiles([indiceFile, ...(await fs.readdir(dirPrompts).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dirPrompts, f))]);
  return runAgent(
    ctx,
    "extender",
    { hashEntrada: solo ? undefined : hash, salidas: () => ["04_extendidas/estado.json"] },
    async () => {
      const indice = imagenIndiceSchema.parse(await readJson(indiceFile));
      await fs.mkdir(dirOut, { recursive: true });
      const w = estadoWriter(ctx, solo ? await leerEstado(ctx) : {});
      let hechas = 0;
      let abortadoPorPresupuesto: string | null = null;

      const pendientes = indice.imagenes.filter((i) => !solo || solo.includes(i.archivo.replace(".jpg", "")));
      const resultados = await pool(pendientes, 2, async (img) => {
        const nombre = img.archivo.replace(".jpg", "");
        const pFile = path.join(dirPrompts, `${nombre}.json`);
        if (!(await exists(pFile))) throw new AgentError(`Falta el prompt de ${nombre}: ejecutá /prompts.`);
        const info = await readJson<PromptImagen>(pFile);
        if (!info.usable && !solo) return null; // excluida
        const original = await fs.readFile(path.join(dirOrig, img.archivo));
        const outFile = path.join(dirOut, `${nombre}.png`);
        try {
          if (abortadoPorPresupuesto) return null;
          if (info.estrategia_extension === "ninguna" || esVertical916(img.ancho, img.alto)) {
            await fs.writeFile(outFile, await normalizeVertical(original));
            await w.set(nombre, { estado: "pendiente", metodo: "original" });
          } else if (forzarBlur) {
            await fs.writeFile(outFile, await blurFill(original));
            await w.set(nombre, { estado: "pendiente", metodo: "blur", nota: "blur elegido" });
          } else {
            const r = await generarConIa(ctx, original, info, ajuste);
            await fs.writeFile(outFile, r.png ?? (await blurFill(original)));
            await w.set(nombre, { estado: r.png ? "pendiente" : "revisar", metodo: r.png ? "ia" : "blur", nota: r.nota });
          }
        } catch (e) {
          if (e instanceof BudgetError) {
            abortadoPorPresupuesto = e.message;
            return null;
          }
          throw e;
        }
        ctx.progress(`🖼 Extendiendo ${++hechas}/${pendientes.length}`);
        return nombre;
      });
      await w.flush();

      const hechasNombres = resultados.filter((x): x is string => !!x).sort();
      if (hechasNombres.length === 0 && abortadoPorPresupuesto) throw new BudgetError(abortadoPorPresupuesto);

      // Un reproceso quita la aprobación de lo regenerado; el resto se conserva.
      await updateManifest(paths, cliente, slug, (m) => {
        const apr = new Set(m.agentes.extender.aprobadas ?? []);
        for (const n of hechasNombres) apr.delete(n);
        m.agentes.extender.aprobadas = [...apr];
      });

      const est = await leerEstado(ctx);
      const mostrar = solo ? hechasNombres : Object.keys(est).sort();
      const media = mostrar.map((n) => {
        const e = est[n]!;
        const botones: Boton[][] = [[{ texto: "🔁 Regenerar", data: `rg:${n}` }, { texto: "🌫 Blur", data: `bl:${n}` }, { texto: "✅ Aprobar", data: `ok:${n}` }]];
        return { path: path.join(dirOut, `${n}.png`), tipo: "foto" as const, caption: `${n} · ${e.metodo}${e.estado === "revisar" ? " ⚠️ revisar" : ""}${e.nota ? ` · ${e.nota}` : ""}`, botones };
      });
      const costo = ctx.gasto ? ` · gasto $${ctx.gasto.toFixed(3)}` : "";
      const aviso = abortadoPorPresupuesto ? `\n⛔ ${abortadoPorPresupuesto} Se procesó una parte; el resto queda pendiente.` : "";
      return {
        texto: `✅ ${hechasNombres.length} imágenes extendidas${costo}. Revisalas una por una y aprobalas.${aviso}`,
        media,
        botones: [[{ texto: "✅ Aprobar todas", data: "okall:x" }]],
      };
    },
  );
}

/** Hasta 2 intentos con IA + paste-back; si fallan, devuelve png=null para usar el fallback blur. */
async function generarConIa(ctx: AgentContext, original: Buffer, info: PromptImagen, ajuste: string): Promise<{ png: Buffer | null; nota?: string }> {
  const base = sharp(original).resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 });
  const imageBase64 = (await base.toBuffer()).toString("base64");
  let nota = "";
  for (let intento = 0; intento < 2; intento++) {
    const prompt = [info.prompt_extension, ajuste, intento > 0 ? skillPrompt("extender", "refuerzo") : ""].filter(Boolean).join("\n\n");
    try {
      await ctx.assertBudget();
      const r = await ctx.llm.image({ model: ctx.config.MODEL_IMAGE, prompt, imageBase64, mime: "image/jpeg", aspectRatio: "9:16", signal: ctx.signal });
      ctx.spend(r.costUsd);
      const png = await pasteBack(r.png, original);
      const dif = await centroConservado(png, original);
      if (dif <= UMBRAL_CENTRO) return { png };
      nota = `el centro difería (${dif.toFixed(1)})`;
    } catch (e) {
      if (e instanceof BudgetError || ctx.signal.aborted) throw e;
      nota = e instanceof Error ? e.message.slice(0, 80) : "error de IA";
    }
  }
  return { png: null, nota: `IA falló: ${nota}. Se usó blur` };
}

/** Aprueba (o desaprueba) una imagen extendida. */
export async function aprobarImagen(ctx: Pick<AgentContext, "paths" | "cliente" | "slug">, nombre: string, aprobar = true): Promise<void> {
  const est = await leerEstado(ctx);
  if (!est[nombre]) throw new AgentError(`No existe la imagen ${nombre}`);
  est[nombre] = { ...est[nombre]!, estado: aprobar ? "aprobada" : "pendiente" };
  await writeJson(estadoFile(ctx), est);
  await updateManifest(ctx.paths, ctx.cliente, ctx.slug, (m) => {
    const s = new Set(m.agentes.extender.aprobadas ?? []);
    if (aprobar) s.add(nombre);
    else s.delete(nombre);
    m.agentes.extender.aprobadas = [...s];
  });
}

export async function aprobarTodas(ctx: Pick<AgentContext, "paths" | "cliente" | "slug">): Promise<number> {
  const est = await leerEstado(ctx);
  const nombres = Object.keys(est);
  for (const n of nombres) est[n] = { ...est[n]!, estado: "aprobada" };
  await writeJson(estadoFile(ctx), est);
  await updateManifest(ctx.paths, ctx.cliente, ctx.slug, (m) => {
    m.agentes.extender.aprobadas = nombres;
  });
  return nombres.length;
}
