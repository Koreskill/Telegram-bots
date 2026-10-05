import type { Caption } from "@remotion/captions";

export interface Palabra {
  texto: string;
  inicio_ms: number;
  fin_ms: number;
}
export interface Transcripcion {
  idioma: string;
  palabras: Palabra[];
}

/** Une los tokens de whisper en palabras: un token con espacio inicial empieza una palabra nueva. */
export function agruparPalabras(captions: Caption[]): Palabra[] {
  const out: Palabra[] = [];
  for (const c of captions) {
    const raw = c.text;
    if (!raw.trim() || /^\s*\[.*\]\s*$/.test(raw)) continue; // [_BEG_], [MUSIC], etc.
    const nueva = /^\s/.test(raw) || out.length === 0;
    const t = raw.trim();
    if (nueva) out.push({ texto: t, inicio_ms: c.startMs, fin_ms: c.endMs });
    else {
      const last = out[out.length - 1]!;
      last.texto += t;
      last.fin_ms = Math.max(last.fin_ms, c.endMs);
    }
  }
  return out;
}

export function aplicarCorrecciones(p: Palabra[], correcciones: { indice: number; texto: string }[]): Palabra[] {
  const out = p.map((x) => ({ ...x }));
  for (const c of correcciones) {
    const w = out[c.indice];
    const t = c.texto.trim();
    if (w && t && !/\s/.test(t)) w.texto = t; // solo reemplazos palabra por palabra
  }
  return out;
}

const pad = (n: number, l = 2) => String(n).padStart(l, "0");
export function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(Math.floor(ms % 1000), 3)}`;
}

/** Agrupa palabras en líneas de subtítulo (corte por pausas, puntuación y largo). */
export function paginas(p: Palabra[], min = 2, max = 4, pausaMs = 450): Palabra[][] {
  const pages: Palabra[][] = [];
  let cur: Palabra[] = [];
  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
  };
  p.forEach((w, i) => {
    cur.push(w);
    const next = p[i + 1];
    const pausa = next ? next.inicio_ms - w.fin_ms > pausaMs : true;
    const fuerte = /[.!?…]$/.test(w.texto);
    const coma = /[,;:]$/.test(w.texto);
    if (cur.length >= max || pausa || fuerte || (coma && cur.length >= min)) flush();
  });
  flush();
  return pages;
}

export function aSrt(p: Palabra[], min = 2, max = 6): string {
  return (
    paginas(p, min, max)
      .map((pg, i) => `${i + 1}\n${srtTime(pg[0]!.inicio_ms)} --> ${srtTime(pg[pg.length - 1]!.fin_ms)}\n${pg.map((w) => w.texto).join(" ")}\n`)
      .join("\n") + "\n"
  );
}

export const textoPlano = (p: Palabra[]) => p.map((w) => w.texto).join(" ");
