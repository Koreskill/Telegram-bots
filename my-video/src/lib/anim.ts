import { interpolate, spring } from "remotion";
import type { Estilo, Palabra, Posicion } from "../types";

/** Resorte con los parámetros del estilo (rigidez/amortiguación), determinista por frame. */
export const springEstilo = (frame: number, fps: number, estilo: Estilo, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { stiffness: estilo.easing.rigidez, damping: estilo.easing.amortiguacion, mass: 1 } });

/** Opacidad con entrada y salida suaves dentro de una ventana de `dur` frames. */
export const fadeInOut = (frame: number, dur: number, fade = 6) =>
  interpolate(frame, [0, fade, Math.max(fade + 1, dur - fade), dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** Agrupa palabras en páginas de subtítulos (mismo criterio que el bot: pausas, puntuación, largo). */
export function paginas(p: Palabra[], min = 2, max = 4, pausaMs = 450): Palabra[][] {
  const out: Palabra[][] = [];
  let cur: Palabra[] = [];
  const flush = () => {
    if (cur.length) out.push(cur);
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
  return out;
}

/** Posición de un overlay en % del cuadro, evitando la zona de subtítulos y los botones de la app. */
export const POS: Record<Posicion, { top: string; left?: string; right?: string; alignItems: "flex-start" | "flex-end" | "center" }> = {
  arriba_izq: { top: "8%", left: "6%", alignItems: "flex-start" },
  arriba_der: { top: "8%", right: "6%", alignItems: "flex-end" },
  arriba_centro: { top: "8%", left: "0%", right: "0%", alignItems: "center" },
  centro: { top: "40%", left: "0%", right: "0%", alignItems: "center" },
  abajo_izq: { top: "44%", left: "6%", alignItems: "flex-start" },
  abajo_centro: { top: "50%", left: "0%", right: "0%", alignItems: "center" },
};

/** Luminancia aproximada (0-1) para elegir texto claro/oscuro sobre un color de fondo. */
export function luminancia(hex: string): number {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.slice(0, 3).map((x) => parseInt(x, 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const textoSobre = (bg: string) => (luminancia(bg) > 0.55 ? "#101010" : "#ffffff");
