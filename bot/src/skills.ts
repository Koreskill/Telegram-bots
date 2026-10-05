import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** bot/skills (válido tanto desde src/ como desde dist/src/). */
export const SKILLS_DIR = process.env.SKILLS_DIR ?? path.resolve(here, "../skills");

export interface Skill {
  id: string;
  meta: Record<string, string>;
  prompts: Record<string, string>;
}

const cache = new Map<string, Skill>();

export function parseSkill(id: string, raw: string): Skill {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  const body = m ? m[2]! : raw;
  for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const prompts: Record<string, string> = {};
  const re = /^## prompt:([\w-]+)[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  for (const p of body.matchAll(re)) prompts[p[1]!] = p[2]!.trim();
  return { id, meta, prompts };
}

export function loadSkill(id: string): Skill {
  const hit = cache.get(id);
  if (hit) return hit;
  const file = path.join(SKILLS_DIR, id, "SKILL.md");
  const s = parseSkill(id, fs.readFileSync(file, "utf8"));
  cache.set(id, s);
  return s;
}

export function listSkills(): Skill[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, "SKILL.md")))
    .map((d) => loadSkill(d.name))
    .sort((a, b) => (a.meta["agente"] ?? "").localeCompare(b.meta["agente"] ?? "", "es", { numeric: true }));
}

/** Prompt de una skill con variables {{clave}} reemplazadas. */
export function skillPrompt(id: string, name = "sistema", vars: Record<string, string> = {}): string {
  const p = loadSkill(id).prompts[name];
  if (!p) throw new Error(`La skill "${id}" no tiene el prompt "${name}"`);
  return p.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}
