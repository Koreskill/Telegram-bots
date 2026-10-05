import fs from "node:fs/promises";
import path from "node:path";
import { estiloSchema, ESTILO_BASE, type Estilo } from "../schemas/plan.js";
import { assertSafeSegment, type Paths } from "../paths.js";
import { extractFrames, probe, sceneCuts } from "../lib/ffmpeg.js";
import { exists, readJson, writeJson } from "../lib/hash.js";
import { skillPrompt } from "../skills.js";
import type { Cliente } from "../schemas/cliente.js";
import type { AgentContext, AgentResult } from "./context.js";

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;

export const estiloDir = (paths: Paths, nombre: string) => path.join(paths.estilosDir, assertSafeSegment(nombre));

export async function listarEstilos(paths: Paths): Promise<{ nombre: string; analizado: boolean; video: string | null }[]> {
  const out: { nombre: string; analizado: boolean; video: string | null }[] = [];
  for (const d of await fs.readdir(paths.estilosDir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const files = await fs.readdir(path.join(paths.estilosDir, d.name));
    out.push({ nombre: d.name, analizado: files.includes("estilo.json"), video: files.find((f) => VIDEO.test(f)) ?? null });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Estilo a usar: el pedido → el del cliente → el primero analizado → base con la marca del cliente. */
export async function resolverEstilo(paths: Paths, cliente: Cliente, pedido?: string): Promise<Estilo> {
  const candidatos = [pedido, cliente.estilo_por_defecto, ...(await listarEstilos(paths)).filter((e) => e.analizado).map((e) => e.nombre)].filter((x): x is string => !!x);
  for (const n of candidatos) {
    const f = path.join(estiloDir(paths, n), "estilo.json");
    if (await exists(f)) return estiloSchema.parse(await readJson(f));
    if (n === pedido) throw new Error(`El estilo "${n}" no tiene estilo.json: ejecutá /estilos primero.`);
  }
  const c = cliente.marca.colores;
  return {
    ...ESTILO_BASE,
    nombre: "base-cliente",
    paleta: { primario: c.primario, acento: c.acento, fondo: "#000000", texto: c.texto },
    tipografia: { titulos: cliente.marca.fuente, cuerpo: cliente.marca.fuente, subtitulos: cliente.marca.fuente },
  };
}

/** Agente 6a: analiza los videos de referencia sin estilo.json (o todos con --forzar). */
export async function estilos(ctx: AgentContext): Promise<AgentResult> {
  const lista = await listarEstilos(ctx.paths);
  if (lista.length === 0) return { texto: `No hay estilos en ${ctx.paths.estilosDir}. Creá una carpeta por estilo con un video de referencia (ej. plantilla/estilos/premium/referencia.mp4).` };
  const hechos: string[] = [];
  const omitidos: string[] = [];
  for (const e of lista) {
    if (e.analizado && !ctx.args["forzar"]) {
      omitidos.push(e.nombre);
      continue;
    }
    if (!e.video) {
      omitidos.push(`${e.nombre} (sin video)`);
      continue;
    }
    ctx.progress(`🎨 Analizando estilo "${e.nombre}"…`);
    const dir = estiloDir(ctx.paths, e.nombre);
    const video = path.join(dir, e.video);
    const info = await probe(video);
    const cortes = await sceneCuts(video, 0.3, ctx.signal);
    const todos = await extractFrames(video, path.join(dir, "_frames"), { everySec: 0.5, extraTimes: cortes, width: 384, signal: ctx.signal });
    const paso = Math.max(1, Math.ceil(todos.length / 30));
    const frames = todos.filter((_, i) => i % paso === 0).slice(0, 30);
    try {
      const parts: ({ type: "text"; text: string } | { type: "image"; base64: string; mime: string })[] = [
        { type: "text", text: `Video de referencia "${e.nombre}": ${info.duracion_s.toFixed(1)} s, ${info.ancho}x${info.alto}. Cortes detectados: ${cortes.length} (${((cortes.length / Math.max(info.duracion_s, 1)) * 60).toFixed(1)} por minuto).` },
      ];
      for (const f of frames) {
        parts.push({ type: "text", text: `t=${f.t.toFixed(1)}s` }, { type: "image", base64: (await fs.readFile(f.file)).toString("base64"), mime: "image/jpeg" });
      }
      await ctx.assertBudget();
      const { data, costUsd } = await ctx.llm.json({
        model: ctx.config.MODEL_VISION,
        system: skillPrompt("estilo"),
        user: parts,
        name: "estilo",
        schema: estiloSchema,
        signal: ctx.signal,
        mock: () => ({ ...ESTILO_BASE, nombre: e.nombre }),
      });
      ctx.spend(costUsd);
      const estilo: Estilo = { ...data, nombre: e.nombre, ritmo: { cortes_por_min: Number(((cortes.length / Math.max(info.duracion_s, 1)) * 60).toFixed(1)) } };
      await writeJson(path.join(dir, "estilo.json"), estilo);
      hechos.push(e.nombre);
    } finally {
      await fs.rm(path.join(dir, "_frames"), { recursive: true, force: true });
    }
  }
  return { texto: [hechos.length ? `✅ Estilos analizados: ${hechos.join(", ")}` : "No había estilos nuevos para analizar.", omitidos.length ? `Ya listos u omitidos: ${omitidos.join(", ")}` : "", "Podés editar cada estilo.json a mano; ese valor manda."].filter(Boolean).join("\n") };
}

