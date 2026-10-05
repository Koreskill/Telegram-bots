import fs from "node:fs/promises";
import path from "node:path";
import type { Paths } from "../paths.js";
import { readJson, writeJson, exists } from "../lib/hash.js";
import { aSrt, type Transcripcion } from "../lib/transcripcion.js";
import { RESTRICCION, type PromptImagen } from "../agents/3-prompts.js";

const IMG = /^img_\d{3,}$/;
export const esNombreImagen = (s: string) => IMG.test(s);

/** Reemplaza el prompt de una imagen (queda marcado como editado: /prompts no lo pisa sin --forzar). */
export async function editarPrompt(paths: Paths, cliente: string, slug: string, img: string, texto: string): Promise<void> {
  if (!esNombreImagen(img)) throw new Error("Nombre de imagen inválido");
  const t = texto.trim();
  if (t.length < 10) throw new Error("El prompt es demasiado corto");
  const file = path.join(paths.subdir(cliente, slug, "prompts"), `${img}.json`);
  if (!(await exists(file))) throw new Error(`No hay prompt para ${img}: ejecutá /prompts.`);
  const cur = await readJson<PromptImagen>(file);
  const prompt = /unchanged/i.test(t) ? t : `${t} ${RESTRICCION}`;
  await writeJson(file, { ...cur, prompt_extension: prompt, editado: true });
}

export async function leerPrompt(paths: Paths, cliente: string, slug: string, img: string): Promise<string | null> {
  if (!esNombreImagen(img)) return null;
  const file = path.join(paths.subdir(cliente, slug, "prompts"), `${img}.json`);
  return (await exists(file)) ? (await readJson<PromptImagen>(file)).prompt_extension : null;
}

/**
 * Reemplaza el texto de los subtítulos palabra por palabra, conservando los tiempos.
 * Exige la misma cantidad de palabras (si no, la sincronización se perdería).
 */
export async function editarSubtitulos(paths: Paths, cliente: string, slug: string, texto: string): Promise<{ ok: true } | { ok: false; esperadas: number; recibidas: number }> {
  const file = path.join(paths.subdir(cliente, slug, "guion"), "transcripcion.json");
  const t = await readJson<Transcripcion>(file);
  const nuevas = texto.trim().split(/\s+/).filter(Boolean);
  if (nuevas.length !== t.palabras.length) return { ok: false, esperadas: t.palabras.length, recibidas: nuevas.length };
  t.palabras = t.palabras.map((w, i) => ({ ...w, texto: nuevas[i]! }));
  await writeJson(file, t);
  await fs.writeFile(path.join(path.dirname(file), "subtitulos.srt"), aSrt(t.palabras));
  return { ok: true };
}

/** Deja listo el destino del video grabado (borra un original anterior y el normalizado viejo). */
export async function destinoVideoSubido(paths: Paths, cliente: string, slug: string, ext: string): Promise<string> {
  const dir = paths.subdir(cliente, slug, "videoGrabado");
  await fs.mkdir(dir, { recursive: true });
  for (const f of await fs.readdir(dir)) if (/^(original\.|trabajo\.mp4)/.test(f)) await fs.rm(path.join(dir, f), { force: true });
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return path.join(dir, `original.${e}`);
}
