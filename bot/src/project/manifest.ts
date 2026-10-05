import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PROJECT_SUBDIRS, type Paths } from "../paths.js";

export const AGENTES = [
  "capturar",
  "imagenes",
  "prompts",
  "extender",
  "guion",
  "voz",
  "video",
  "publicar",
] as const;
export type AgenteId = (typeof AGENTES)[number];

export const ESTADOS = ["pending", "running", "done", "error", "skipped"] as const;

const agenteSchema = z
  .object({
    estado: z.enum(ESTADOS).default("pending"),
    inicio: z.string().optional(),
    fin: z.string().optional(),
    salidas: z.array(z.string()).optional(),
    costo_usd: z.number().nonnegative().optional(),
    hash_entrada: z.string().optional(),
    mensaje: z.string().optional(),
    aprobadas: z.array(z.string()).optional(),
  })
  .passthrough();
export type AgenteEstado = z.infer<typeof agenteSchema>;

export const manifestSchema = z.object({
  version: z.literal(1),
  cliente: z.string(),
  slug: z.string(),
  url_origen: z.string().nullable().default(null),
  creado: z.string(),
  agentes: z.object(
    Object.fromEntries(AGENTES.map((a) => [a, agenteSchema.default({ estado: "pending" })])) as Record<
      AgenteId,
      z.ZodDefault<typeof agenteSchema>
    >,
  ),
  costo_total_usd: z.number().nonnegative().default(0),
});
export type Manifest = z.infer<typeof manifestSchema>;

// Exclusión mutua por archivo dentro del proceso (el bot es un único proceso).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

async function readRaw(file: string): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

/** Escritura atómica: archivo temporal en la misma carpeta + rename. */
async function writeAtomic(file: string, data: Manifest): Promise<void> {
  const tmp = path.join(path.dirname(file), `.manifest.${randomBytes(4).toString("hex")}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

function recomputeCost(m: Manifest): void {
  m.costo_total_usd = Number(
    Object.values(m.agentes)
      .reduce((s, a) => s + (a.costo_usd ?? 0), 0)
      .toFixed(6),
  );
}

export function newManifest(cliente: string, slug: string, urlOrigen: string | null = null): Manifest {
  return manifestSchema.parse({
    version: 1,
    cliente,
    slug,
    url_origen: urlOrigen,
    creado: new Date().toISOString(),
    agentes: {},
    costo_total_usd: 0,
  });
}

/** Crea la carpeta del proyecto con todos sus subdirectorios y el manifest inicial. */
export async function createProject(
  paths: Paths,
  cliente: string,
  slug: string,
  urlOrigen: string | null = null,
): Promise<Manifest> {
  const dir = paths.proyectoDir(cliente, slug);
  await fs.mkdir(dir, { recursive: true });
  for (const sub of Object.values(PROJECT_SUBDIRS)) await fs.mkdir(path.join(dir, sub), { recursive: true });
  const file = paths.manifest(cliente, slug);
  return withLock(file, async () => {
    try {
      return await readRaw(file); // ya existe: no se pisa
    } catch {
      const m = newManifest(cliente, slug, urlOrigen);
      await writeAtomic(file, m);
      return m;
    }
  });
}

export function readManifest(paths: Paths, cliente: string, slug: string): Promise<Manifest> {
  const file = paths.manifest(cliente, slug);
  return withLock(file, () => readRaw(file));
}

/** Lee-modifica-escribe de forma serializada y atómica. */
export function updateManifest(
  paths: Paths,
  cliente: string,
  slug: string,
  mutate: (m: Manifest) => void,
): Promise<Manifest> {
  const file = paths.manifest(cliente, slug);
  return withLock(file, async () => {
    const m = await readRaw(file);
    mutate(m);
    recomputeCost(m);
    await writeAtomic(file, m);
    return m;
  });
}

export function setAgente(
  paths: Paths,
  cliente: string,
  slug: string,
  agente: AgenteId,
  patch: Partial<AgenteEstado>,
): Promise<Manifest> {
  return updateManifest(paths, cliente, slug, (m) => {
    m.agentes[agente] = { ...m.agentes[agente], ...patch };
  });
}

/** Lista los proyectos (slugs) de un cliente, ordenados por nombre. */
export async function listProjects(paths: Paths, cliente: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths.proyectosDir(cliente), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Lista los clientes reales (carpetas dentro de clientes/). Solo lectura. */
export async function listClients(paths: Paths): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths.clientesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
