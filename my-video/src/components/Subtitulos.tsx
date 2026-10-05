import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { Estilo, Palabra } from "../types";
import { paginas, springEstilo, textoSobre } from "../lib/anim";

const TOP: Record<Estilo["subtitulos"]["posicion"], string> = {
  abajo: "64%", // por encima del 20 % inferior que tapan los botones de Reels/TikTok
  centro: "44%",
  arriba: "18%",
};

/** Subtítulos palabra por palabra: la palabra activa se resalta; la página entra con un "pop". */
export const Subtitulos: React.FC<{ palabras: Palabra[]; estilo: Estilo; grupo: [number, number]; alto: number }> = ({ palabras, estilo, grupo, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const pgs = React.useMemo(() => paginas(palabras, grupo[0], grupo[1]), [palabras, grupo]);
  const idx = pgs.findIndex((pg, i) => {
    const ini = pg[0]!.inicio_ms - 80;
    const fin = i + 1 < pgs.length ? Math.min(pg[pg.length - 1]!.fin_ms + 250, pgs[i + 1]![0]!.inicio_ms) : pg[pg.length - 1]!.fin_ms + 250;
    return ms >= ini && ms < fin;
  });
  if (idx < 0) return null;
  const pg = pgs[idx]!;
  const s = estilo.subtitulos;
  const t0 = Math.round(((pg[0]!.inicio_ms - 80) / 1000) * fps);
  const entrada = s.animacion === "ninguna" ? 1 : springEstilo(frame, fps, estilo, t0);
  const opacidad = s.animacion === "fade" ? interpolate(frame - t0, [0, 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : Math.min(1, entrada * 2);
  const size = Math.round(alto * s.tamano_rel);
  const sombra = s.contorno ? `0 ${size * 0.04}px ${size * 0.1}px rgba(0,0,0,.55)` : "none";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: TOP[s.posicion],
          left: "7%",
          right: "7%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${size * 0.12}px ${size * 0.28}px`,
          opacity: opacidad,
          scale: s.animacion === "pop" ? 0.82 + 0.18 * entrada : 1,
          fontFamily: `"${estilo.tipografia.subtitulos}", sans-serif`,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.1,
          textAlign: "center",
          letterSpacing: s.mayusculas ? size * 0.01 : 0,
          textTransform: s.mayusculas ? "uppercase" : "none",
        }}
      >
        {pg.map((w, i) => {
          const activa = ms >= w.inicio_ms && ms < w.fin_ms + 60;
          const pasada = ms >= w.fin_ms + 60;
          const t = Math.round((w.inicio_ms / 1000) * fps);
          const pop = activa && s.resaltado === "escala" ? 1 + 0.14 * Math.min(1, springEstilo(frame, fps, estilo, t)) : 1;
          const color = activa && s.resaltado === "color" ? estilo.paleta.acento : activa && s.resaltado === "fondo" ? textoSobre(estilo.paleta.acento) : estilo.paleta.texto;
          return (
            <span
              key={i}
              style={{
                color,
                opacity: pasada || activa ? 1 : 0.85,
                scale: pop,
                padding: s.resaltado === "fondo" && activa ? `0 ${size * 0.22}px` : 0,
                borderRadius: size * 0.22,
                background: s.resaltado === "fondo" && activa ? estilo.paleta.acento : "transparent",
                WebkitTextStroke: s.contorno && !(s.resaltado === "fondo" && activa) ? `${Math.max(2, size * 0.07)}px rgba(0,0,0,.9)` : undefined,
                paintOrder: "stroke fill",
                textShadow: sombra,
                display: "inline-block",
              }}
            >
              {w.texto}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
