import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { analisisImagenSchema, imagenIndiceSchema, propiedadSchema, type AnalisisImagen } from "../schemas/propiedad.js";
import { esVertical916, orientacion } from "../lib/imagen.js";
import { hashFiles, readJson, writeJson, exists } from "../lib/hash.js";
import { skillPrompt } from "../skills.js";
import { AgentError, pool, runAgent, type AgentContext, type AgentResult, type Boton } from "./context.js";

export const RESTRICCION =
  "Keep the original photo completely unchanged in the center. Do not alter, move, add or remove any object, furniture, wall, window, building or person. Photorealistic, same lighting and color grading, no text, no watermark.";

export interface PromptImagen extends AnalisisImagen {
  archivo: string;
  ancho: number;
  alto: number;
  editado: boolean;
}

/** Reglas de negocio que el LLM no puede violar (orientación y restricción de no alterar). */
export function normalizarAnalisis(a: AnalisisImagen, ancho: number, alto: number): AnalisisImagen {
  const or = orientacion(ancho, alto);
  let estrategia = a.estrategia_extension;
  if (esVertical916(ancho, alto)) estrategia = "ninguna";
  else if (estrategia === "ninguna") estrategia = "arriba_y_abajo";
  let prompt = a.prompt_extension.trim();
  if (estrategia !== "ninguna" && !/unchanged/i.test(prompt)) prompt = `${prompt} ${RESTRICCION}`.trim();
  return { ...a, orientacion_original: or, estrategia_extension: estrategia, prompt_extension: prompt };
}

export async function prompts(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const dirOrig = paths.subdir(cliente, slug, "originales");
  const indiceFile = path.join(dirOrig, "indice.json");
  return runAgent(
    ctx,
    "prompts",
    { hashEntrada: await hashFiles([indiceFile]), salidas: () => ["03_prompts/resumen.md"] },
    async () => {
      if (!(await exists(indiceFile))) throw new AgentError("Primero ejecutá /imagenes (no hay indice.json).");
      const indice = imagenIndiceSchema.parse(await readJson(indiceFile));
      const prop = propiedadSchema.parse(await readJson(paths.file(cliente, slug, "datos", "propiedad.json")));
      const dirOut = paths.subdir(cliente, slug, "prompts");
      await fs.mkdir(dirOut, { recursive: true });
      const sistema = skillPrompt("prompts");
      let hechas = 0;

      const out = await pool(indice.imagenes, 4, async (img): Promise<PromptImagen> => {
        const nombre = img.archivo.replace(/\.jpg$/, "");
        const file = path.join(dirOut, `${nombre}.json`);
        // Un prompt editado a mano se conserva salvo --forzar.
        if (!ctx.args["forzar"] && (await exists(file))) {
          const prev = (await readJson<PromptImagen>(file)) as PromptImagen;
          if (prev.editado) return prev;
        }
        const buf = await sharp(path.join(dirOrig, img.archivo)).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        await ctx.assertBudget();
        const { data, costUsd } = await ctx.llm.json({
          model: ctx.config.MODEL_VISION,
          system: sistema,
          user: [
            { type: "text", text: `Propiedad: ${prop.tipo_propiedad ?? "?"} en ${prop.ubicacion.barrio ?? prop.ubicacion.ciudad ?? "?"}. Orientación original: ${img.orientacion} (${img.ancho}x${img.alto}). Analizá esta imagen.` },
            { type: "image", base64: buf.toString("base64"), mime: "image/jpeg" },
          ],
          name: "analisis_imagen",
          schema: analisisImagenSchema,
          signal: ctx.signal,
          mock: () => mockAnalisis(img.orientacion, nombre),
        });
        ctx.spend(costUsd);
        const final: PromptImagen = { ...normalizarAnalisis(data, img.ancho, img.alto), archivo: img.archivo, ancho: img.ancho, alto: img.alto, editado: false };
        await writeJson(file, final);
        ctx.progress(`🔎 Analizando imágenes ${++hechas}/${indice.imagenes.length}`);
        return final;
      });

      const filas = out.map((p) => `| ${p.archivo} | ${p.tipo_ambiente} | ${p.estrategia_extension} | ${p.calidad}/5 | ${p.usable ? "sí" : "NO"} | ${p.riesgos.join("; ") || "—"} |`);
      const md = ["# Prompts de extensión", "", "| Imagen | Ambiente | Estrategia | Calidad | Usable | Riesgos |", "|---|---|---|---|---|---|", ...filas, "", ...out.map((p) => `## ${p.archivo}\n${p.descripcion_corta}\n\n\`${p.prompt_extension}\`\n`)].join("\n");
      await fs.writeFile(path.join(dirOut, "resumen.md"), md);

      const usables = out.filter((p) => p.usable);
      const resumen = out.map((p) => `${p.usable ? "✅" : "🚫"} ${p.archivo.replace(".jpg", "")} · ${p.tipo_ambiente} · ${p.estrategia_extension === "ninguna" ? "sin extender" : "extender"} · ${p.calidad}/5`).join("\n");
      const edits: Boton[][] = [];
      const editables = out.filter((p) => p.estrategia_extension !== "ninguna").slice(0, 12);
      for (let i = 0; i < editables.length; i += 3) edits.push(editables.slice(i, i + 3).map((p) => ({ texto: `✏️ ${p.archivo.replace(/img_0*|\.jpg/g, "")}`, data: `ep:${p.archivo.replace(".jpg", "")}` })));
      return {
        texto: `✅ ${usables.length}/${out.length} imágenes usables para ${prop.titulo ?? slug}\n\n${resumen}\n\nPodés editar un prompt (✏️) antes de gastar créditos.`,
        botones: [...edits, [{ texto: "✅ Aprobar y extender (/extender)", data: "next:extender" }]],
      };
    },
  );
}

function mockAnalisis(or: "horizontal" | "vertical" | "cuadrada", nombre: string): AnalisisImagen {
  return {
    tipo_ambiente: or === "vertical" ? "detalle" : "living",
    descripcion_corta: `Foto ${nombre} de ambiente (mock)`,
    calidad: 4,
    orientacion_original: or,
    estrategia_extension: or === "vertical" ? "ninguna" : "arriba_y_abajo",
    prompt_extension: `Extend the scene upward with ceiling and downward with floor. ${RESTRICCION}`,
    riesgos: [],
    usable: true,
  };
}
