/** "/video premium --final" → { pos: ["premium"], flags: { final: true } }. Soporta --clave=valor. */
export function parseArgs(text: string): { pos: string[]; flags: Record<string, string | true> } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (const t of tokens) {
    if (t.startsWith("--")) {
      const [k, ...v] = t.slice(2).split("=");
      if (k) flags[k] = v.length ? v.join("=") : true;
    } else pos.push(t);
  }
  return { pos, flags };
}

const URL_RE = /^https?:\/\/\S+$/i;
export const esUrl = (s: string) => URL_RE.test(s.trim());

/** Fecha "2026-10-12 18:30" (hora Argentina, UTC-3 sin horario de verano) → ISO con offset. */
export function parseFechaAR(texto: string, ahora = new Date()): string | null {
  const m = texto.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const iso = `${y}-${mo}-${d}T${h!.padStart(2, "0")}:${mi}:00-03:00`;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime()) || t.getTime() <= ahora.getTime()) return null;
  return iso;
}
