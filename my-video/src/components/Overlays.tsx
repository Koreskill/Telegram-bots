import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EdicionProps, Overlay } from "../types";
import { POS, fadeInOut, springEstilo, textoSobre } from "../lib/anim";
import { Icono } from "./Icono";

type P = { o: Overlay; durFrames: number; estilo: EdicionProps["estilo"]; ancho: number; alto: number };

const base = (alto: number): React.CSSProperties => ({ position: "absolute", display: "flex", flexDirection: "column", pointerEvents: "none", fontSize: alto * 0.024 });

const Contenedor: React.FC<{ pos: keyof typeof POS; alto: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ pos, alto, children, style }) => {
  const p = POS[pos];
  return (
    <div style={{ ...base(alto), top: p.top, left: p.left, right: p.right, alignItems: p.alignItems, ...style }}>{children}</div>
  );
};

export const Titulo: React.FC<P> = ({ o, durFrames, estilo, alto, ancho }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = springEstilo(frame, fps, estilo);
  const e2 = springEstilo(frame, fps, estilo, 6);
  const size = alto * 0.052;
  return (
    <Contenedor pos={o.posicion ?? "abajo_izq"} alto={alto} style={{ opacity: fadeInOut(frame, durFrames, 8), translate: `0 ${(1 - e) * 40}px` }}>
      <div style={{ fontFamily: `"${estilo.tipografia.titulos}", sans-serif`, fontWeight: 800, fontSize: size, lineHeight: 1.05, color: estilo.paleta.texto, textShadow: "0 4px 24px rgba(0,0,0,.55)", width: "max-content", maxWidth: ancho * 0.88 }}>{o.texto}</div>
      {o.subtexto ? (
        <div style={{ marginTop: size * 0.3, scale: 0.85 + 0.15 * e2, opacity: Math.min(1, e2 * 2), transformOrigin: "left center", background: estilo.paleta.acento, color: textoSobre(estilo.paleta.acento), fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 800, fontSize: size * 0.4, letterSpacing: size * 0.04, padding: `${size * 0.14}px ${size * 0.38}px`, borderRadius: 999 }}>
          {o.subtexto}
        </div>
      ) : null}
    </Contenedor>
  );
};

export const ChipAmenity: React.FC<P> = ({ o, durFrames, estilo, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = springEstilo(frame, fps, estilo);
  const size = alto * 0.03;
  const dir = (o.posicion ?? "arriba_der") === "arriba_izq" ? -1 : 1;
  return (
    <Contenedor pos={o.posicion ?? "arriba_der"} alto={alto} style={{ opacity: fadeInOut(frame, durFrames, 7), translate: `${(1 - e) * 120 * dir}px 0` }}>
      <div style={{ display: "flex", alignItems: "center", gap: size * 0.45, background: `${estilo.paleta.primario}ee`, borderRadius: 999, padding: `${size * 0.3}px ${size * 0.8}px ${size * 0.3}px ${size * 0.3}px`, boxShadow: "0 8px 30px rgba(0,0,0,.35)", border: `${Math.max(2, size * 0.06)}px solid ${estilo.paleta.acento}55` }}>
        <div style={{ width: size * 1.7, height: size * 1.7, borderRadius: "50%", background: estilo.paleta.acento, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icono nombre={o.icono ?? o.texto} size={size * 1.05} color={textoSobre(estilo.paleta.acento)} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 800, fontSize: size, color: estilo.paleta.texto, lineHeight: 1.1 }}>{o.texto}</span>
          {o.subtexto ? <span style={{ fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 500, fontSize: size * 0.62, color: estilo.paleta.texto, opacity: 0.8 }}>{o.subtexto}</span> : null}
        </div>
      </div>
    </Contenedor>
  );
};

export const LowerThird: React.FC<P> = ({ o, durFrames, estilo, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = springEstilo(frame, fps, estilo);
  const size = alto * 0.03;
  return (
    <Contenedor pos={o.posicion ?? "abajo_izq"} alto={alto} style={{ opacity: fadeInOut(frame, durFrames, 7), translate: `${(1 - e) * -90}px 0` }}>
      <div style={{ borderLeft: `${size * 0.22}px solid ${estilo.paleta.acento}`, background: `${estilo.paleta.primario}d9`, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: size * 0.3 }}>
        <div style={{ fontFamily: `"${estilo.tipografia.titulos}", sans-serif`, fontWeight: 800, fontSize: size * 1.1, color: estilo.paleta.texto }}>{o.texto}</div>
        {o.subtexto ? <div style={{ fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontSize: size * 0.72, color: estilo.paleta.texto, opacity: 0.85 }}>{o.subtexto}</div> : null}
      </div>
    </Contenedor>
  );
};

export const Etiqueta: React.FC<P> = ({ o, durFrames, estilo, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = springEstilo(frame, fps, estilo);
  const size = alto * 0.022;
  const parpadeo = Math.floor(frame / (fps / 2)) % 2 === 0; // determinista: sin Math.random ni timers
  return (
    <Contenedor pos={o.posicion ?? "arriba_izq"} alto={alto} style={{ opacity: fadeInOut(frame, durFrames, 6), scale: 0.9 + 0.1 * e }}>
      <div style={{ display: "flex", alignItems: "center", gap: size * 0.6, background: "rgba(0,0,0,.55)", borderRadius: size * 0.5, padding: `${size * 0.4}px ${size * 0.9}px` }}>
        <span style={{ width: size * 0.8, height: size * 0.8, borderRadius: "50%", background: "#ff2d2d", opacity: parpadeo ? 1 : 0.25 }} />
        <span style={{ fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 800, fontSize: size, letterSpacing: size * 0.12, color: "#fff" }}>{o.texto}</span>
      </div>
    </Contenedor>
  );
};

export const Precio: React.FC<P> = ({ o, durFrames, estilo, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = springEstilo(frame, fps, estilo);
  const size = alto * 0.04;
  return (
    <Contenedor pos={o.posicion ?? "arriba_der"} alto={alto} style={{ opacity: fadeInOut(frame, durFrames, 7), scale: 0.8 + 0.2 * e }}>
      <div style={{ background: estilo.paleta.acento, color: textoSobre(estilo.paleta.acento), fontFamily: `"${estilo.tipografia.titulos}", sans-serif`, fontWeight: 800, fontSize: size, padding: `${size * 0.25}px ${size * 0.7}px`, borderRadius: size * 0.4, boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}>
        {o.texto}
        {o.subtexto ? <div style={{ fontSize: size * 0.4, fontWeight: 600, opacity: 0.8 }}>{o.subtexto}</div> : null}
      </div>
    </Contenedor>
  );
};

/** Barra fina arriba que crece a lo largo de todo el video. */
export const BarraProgreso: React.FC<P> = ({ o, durFrames, estilo, alto }) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [0, durFrames], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  void o;
  return <div style={{ position: "absolute", top: 0, left: 0, height: Math.max(6, alto * 0.004), width: `${w}%`, background: estilo.paleta.acento, boxShadow: `0 0 12px ${estilo.paleta.acento}` }} />;
};

export const OverlayView: React.FC<P> = (p) => {
  switch (p.o.tipo) {
    case "titulo": return <Titulo {...p} />;
    case "chip_amenity": return <ChipAmenity {...p} />;
    case "lower_third": return <LowerThird {...p} />;
    case "etiqueta": return <Etiqueta {...p} />;
    case "precio": return <Precio {...p} />;
    case "barra_progreso": return <BarraProgreso {...p} />;
    default: return <AbsoluteFill />;
  }
};
