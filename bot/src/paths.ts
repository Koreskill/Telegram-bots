import path from "node:path";

/**
 * ÚNICO lugar que conoce la estructura de carpetas (ver docs/INSTRUCTIVO.md §3).
 * Cuando se complete la Fase 0 (docs/ESTRUCTURA-REAL.md), solo se ajusta este archivo.
 */

export const PROJECT_SUBDIRS = {
  datos: "01_datos",
  media: "02_media",
  originales: "02_media/originales",
  videoGrabado: "02_media/video_grabado",
  prompts: "03_prompts",
  extendidas: "04_extendidas",
  guion: "05_guion",
  voz: "05_guion/voz",
  video: "06_video",
} as const;
export type ProjectSubdir = keyof typeof PROJECT_SUBDIRS;

/** Segmento de ruta seguro: sin separadores, sin "..", sin punto inicial, sin control chars. */
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,99}$/u;

export class UnsafePathError extends Error {}

export function assertSafeSegment(name: string): string {
  if (typeof name !== "string" || !SEGMENT.test(name) || name.includes("..") || name !== name.trim()) {
    throw new UnsafePathError(`Nombre no permitido: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Convierte texto libre en slug ASCII en minúsculas (para carpetas de proyecto nuevas). */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "proyecto";
}

function inside(root: string, target: string): string {
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new UnsafePathError(`Ruta fuera de ${root}: ${target}`);
  }
  return target;
}

export function createPaths(dataDir: string) {
  const root = path.resolve(dataDir);
  const clientesDir = path.join(root, "clientes");
  const plantillaDir = path.join(root, "plantilla");

  const clienteDir = (cliente: string) =>
    inside(clientesDir, path.join(clientesDir, assertSafeSegment(cliente)));
  const proyectosDir = (cliente: string) => path.join(clienteDir(cliente), "proyectos");
  const proyectoDir = (cliente: string, slug: string) =>
    inside(proyectosDir(cliente), path.join(proyectosDir(cliente), assertSafeSegment(slug)));

  return {
    root,
    clientesDir,
    plantillaDir,
    estilosDir: path.join(plantillaDir, "estilos"),
    clienteDir,
    clienteJson: (cliente: string) => path.join(clienteDir(cliente), "cliente.json"),
    proyectosDir,
    proyectoDir,
    manifest: (cliente: string, slug: string) => path.join(proyectoDir(cliente, slug), "manifest.json"),
    subdir: (cliente: string, slug: string, sub: ProjectSubdir) =>
      inside(proyectoDir(cliente, slug), path.join(proyectoDir(cliente, slug), PROJECT_SUBDIRS[sub])),
    /** Archivo dentro de un subdirectorio del proyecto (el nombre de archivo también se valida). */
    file: (cliente: string, slug: string, sub: ProjectSubdir, fileName: string) => {
      const dir = path.join(proyectoDir(cliente, slug), PROJECT_SUBDIRS[sub]);
      return inside(dir, path.join(dir, assertSafeSegment(fileName)));
    },
    /** SQLite de la cola/estado; vive en el volumen para sobrevivir reinicios. */
    dbFile: path.join(root, "bot.sqlite"),
  };
}
export type Paths = ReturnType<typeof createPaths>;
