import sharp from "sharp";

export const OUT_W = 1080;
export const OUT_H = 1920;
export type Orientacion = "horizontal" | "vertical" | "cuadrada";

export function orientacion(w: number, h: number): Orientacion {
  const r = w / h;
  if (r > 1.08) return "horizontal";
  if (r < 0.92) return "vertical";
  return "cuadrada";
}

export async function inspect(buf: Buffer): Promise<{ width: number; height: number; format: string }> {
  const m = await sharp(buf, { failOn: "none" }).metadata();
  if (!m.width || !m.height || !m.format) throw new Error("No es una imagen válida");
  return { width: m.width, height: m.height, format: m.format };
}

/** Convierte cualquier formato (webp/avif/png…) a JPEG de calidad alta, respetando la rotación EXIF. */
export const toJpeg = (buf: Buffer, quality = 92) => sharp(buf, { failOn: "none" }).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();

/** dHash perceptual de 64 bits (hex de 16 chars). */
export async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf, { failOn: "none" }).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x]! > px[y * 9 + x + 1]! ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Heurística para descartar logos, íconos, banners y sprites. */
export function descarteMotivo(w: number, h: number, bytes: number): string | null {
  if (Math.max(w, h) < 800) return `muy chica (${w}x${h})`;
  const r = w / h;
  if (r > 4 || r < 0.25) return `proporción extrema (${w}x${h})`;
  if (bytes < 15 * 1024) return "archivo demasiado liviano";
  return null;
}

/** Ya es (casi) 9:16: no hace falta extender. */
export const esVertical916 = (w: number, h: number) => Math.abs(w / h - OUT_W / OUT_H) < 0.02;

/** Fondo desenfocado + original centrada. Fallback sin IA, determinista. */
export async function blurFill(original: Buffer, w = OUT_W, h = OUT_H): Promise<Buffer> {
  const bg = await sharp(original, { failOn: "none" })
    .rotate()
    .resize(w, h, { fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.55, saturation: 1.1 })
    .toBuffer();
  const fg = await sharp(original, { failOn: "none" }).rotate().resize(w, h, { fit: "inside", withoutEnlargement: false }).toBuffer();
  return sharp(bg).composite([{ input: fg, gravity: "centre" }]).png().toBuffer();
}

/** Original ya vertical 9:16: solo se normaliza. */
export const normalizeVertical = (original: Buffer, w = OUT_W, h = OUT_H) =>
  sharp(original, { failOn: "none" }).rotate().resize(w, h, { fit: "cover" }).png().toBuffer();

/**
 * Paste-back: pega la foto ORIGINAL (escalada al ancho final) sobre el centro de la versión generada
 * por IA, con bordes superior/inferior difuminados. Los píxeles reales de la propiedad nunca los
 * decide el modelo: la IA solo aporta las franjas de arriba y abajo.
 */
export async function pasteBack(generated: Buffer, original: Buffer, o: { w?: number; h?: number; feather?: number } = {}): Promise<Buffer> {
  const w = o.w ?? OUT_W;
  const h = o.h ?? OUT_H;
  const feather = o.feather ?? 24;
  const bg = await sharp(generated, { failOn: "none" }).resize(w, h, { fit: "cover" }).toBuffer();
  const fgSharp = sharp(original, { failOn: "none" }).rotate().resize(w, h, { fit: "inside" });
  const { data: fgRaw, info } = await fgSharp.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const top = Math.round((h - info.height) / 2);
  const left = Math.round((w - info.width) / 2);
  // Máscara alfa: rampa en los bordes que NO tocan el límite del lienzo.
  const mask = Buffer.alloc(info.width * info.height, 255);
  const ramp = Math.min(feather, Math.floor(info.height / 4));
  for (let y = 0; y < info.height; y++) {
    let a = 1;
    if (top > 0 && y < ramp) a = Math.min(a, (y + 1) / ramp);
    if (top + info.height < h && y >= info.height - ramp) a = Math.min(a, (info.height - y) / ramp);
    if (a < 1) mask.fill(Math.round(255 * a), y * info.width, (y + 1) * info.width);
  }
  const fg = await sharp(fgRaw, { raw: { width: info.width, height: info.height, channels: 3 } })
    .joinChannel(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toBuffer();
  return sharp(bg).composite([{ input: fg, left, top }]).png().toBuffer();
}

/** Diferencia media absoluta (0-255) entre dos imágenes tras llevarlas a un tamaño común. */
export async function meanAbsDiff(a: Buffer, b: Buffer, size = 64): Promise<number> {
  const [x, y] = await Promise.all(
    [a, b].map((buf) => sharp(buf, { failOn: "none" }).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer()),
  );
  let s = 0;
  for (let i = 0; i < x!.length; i++) s += Math.abs(x![i]! - y![i]!);
  return s / x!.length;
}

/** Recorta la franja central de `result` que corresponde a la original y la compara con ella. */
export async function centroConservado(result: Buffer, original: Buffer, w = OUT_W, h = OUT_H): Promise<number> {
  const fg = await sharp(original, { failOn: "none" }).rotate().resize(w, h, { fit: "inside" }).png().toBuffer();
  const m = await sharp(fg).metadata();
  const top = Math.round((h - m.height!) / 2);
  const inset = 40; // ignora el degradado de borde
  const region = await sharp(result)
    .extract({ left: 0, top: top + inset, width: m.width!, height: Math.max(1, m.height! - inset * 2) })
    .png()
    .toBuffer();
  const orig = await sharp(fg).extract({ left: 0, top: inset, width: m.width!, height: Math.max(1, m.height! - inset * 2) }).png().toBuffer();
  return meanAbsDiff(region, orig);
}
