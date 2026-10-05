import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export const sha1 = (data: string | Buffer) => createHash("sha1").update(data).digest("hex");

/** Hash del contenido de varios archivos (los que no existen cuentan como vacío). */
export async function hashFiles(files: string[]): Promise<string> {
  const h = createHash("sha1");
  for (const f of files) {
    h.update(f);
    try {
      h.update(await fs.readFile(f));
    } catch {
      h.update("∅");
    }
  }
  return h.digest("hex");
}

export async function exists(f: string): Promise<boolean> {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(f: string): Promise<T> {
  return JSON.parse(await fs.readFile(f, "utf8")) as T;
}

export async function writeJson(f: string, data: unknown): Promise<void> {
  await fs.writeFile(f, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Hash barato por tamaño + fecha de modificación (para archivos grandes como videos). */
export async function statHash(files: string[]): Promise<string> {
  const h = createHash("sha1");
  for (const f of files) {
    try {
      const s = await fs.stat(f);
      h.update(`${f}:${s.size}:${Math.floor(s.mtimeMs)}`);
    } catch {
      h.update(`${f}:∅`);
    }
  }
  return h.digest("hex");
}
