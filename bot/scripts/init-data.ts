/**
 * Crea (sin pisar nada) la estructura de datos en DATA_DIR a partir de datos-ejemplo/.
 * Uso: `DATA_DIR=./data npm run init-data`
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const origen = path.resolve(here, "../../datos-ejemplo");
const destino = path.resolve(process.env.DATA_DIR ?? "./data");

async function copiar(src: string, dst: string): Promise<number> {
  let n = 0;
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += await copiar(s, d);
    else if (e.name !== "LEEME.md" || !src.endsWith("datos-ejemplo")) {
      try {
        await fs.copyFile(s, d, fs.constants.COPYFILE_EXCL); // no pisa archivos existentes
        n++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  }
  return n;
}

const n = await copiar(origen, destino);
console.log(`✅ ${n} archivo(s) creados en ${destino}. Lo que ya existía no se tocó.`);
