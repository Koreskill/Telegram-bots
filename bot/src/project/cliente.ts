import fs from "node:fs/promises";
import path from "node:path";
import { clienteSchema, clienteVacio, type Cliente } from "../schemas/cliente.js";
import { PROJECT_SUBDIRS, slugify, type Paths } from "../paths.js";
import { exists, writeJson } from "../lib/hash.js";

/** Lee cliente.json; si no existe devuelve un cliente mínimo con valores por defecto (solo lectura). */
export async function loadCliente(paths: Paths, cliente: string): Promise<Cliente> {
  try {
    const raw = JSON.parse(await fs.readFile(paths.clienteJson(cliente), "utf8")) as unknown;
    return clienteSchema.parse(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return clienteVacio(cliente);
    throw new Error(`cliente.json de "${cliente}" inválido: ${e instanceof Error ? e.message : e}`);
  }
}

/** Crea la carpeta de un cliente nuevo con su cliente.json. No pisa clientes existentes. */
export async function createCliente(paths: Paths, nombre: string): Promise<{ id: string; creado: boolean }> {
  const id = nombre.trim();
  const dir = paths.clienteDir(id);
  if (await exists(dir)) return { id, creado: false };
  await fs.mkdir(path.join(dir, "proyectos"), { recursive: true });
  await writeJson(paths.clienteJson(id), clienteVacio(id));
  return { id, creado: true };
}

/** Slug único de proyecto dentro del cliente: base, base-2, base-3… */
export async function slugUnico(paths: Paths, cliente: string, base: string): Promise<string> {
  const b = slugify(base);
  for (let i = 1; i < 1000; i++) {
    const s = i === 1 ? b : `${b}-${i}`;
    if (!(await exists(paths.proyectoDir(cliente, s)))) return s;
  }
  throw new Error("No se pudo generar un slug único");
}

/** Estructura de carpetas de una propiedad (para documentación y /ayuda). */
export const ESTRUCTURA_PROYECTO = Object.values(PROJECT_SUBDIRS);
