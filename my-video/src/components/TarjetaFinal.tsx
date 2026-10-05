import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { EdicionProps, Overlay } from "../types";
import { springEstilo, textoSobre } from "../lib/anim";

/** Tarjeta final: oscurece el cuadro, logo, título, CTA con latido y datos de contacto del cliente. */
export const TarjetaFinal: React.FC<{ o: Overlay; durFrames: number; estilo: EdicionProps["estilo"]; cliente: EdicionProps["cliente"]; alto: number }> = ({ o, durFrames, estilo, cliente, alto }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e0 = springEstilo(frame, fps, estilo);
  const e1 = springEstilo(frame, fps, estilo, 6);
  const e2 = springEstilo(frame, fps, estilo, 12);
  const e3 = springEstilo(frame, fps, estilo, 18);
  const fondo = interpolate(frame, [0, 10], [0, 0.72], { extrapolateRight: "clamp" });
  const size = alto * 0.05;
  const latido = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2 * 1.2); // determinista
  const c = cliente.contacto;
  const lineas = [c.whatsapp && `WhatsApp ${c.whatsapp}`, c.telefono && c.telefono !== c.whatsapp && `Tel. ${c.telefono}`, c.web, c.instagram].filter(Boolean) as string[];
  void durFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${fondo})`, alignItems: "center", justifyContent: "center", gap: size * 0.5, display: "flex", flexDirection: "column", textAlign: "center", padding: "0 8%" }}>
      {cliente.logo ? <Img src={staticFile(cliente.logo)} style={{ height: alto * 0.07, objectFit: "contain", opacity: e0, scale: 0.8 + 0.2 * e0 }} /> : null}
      <div style={{ fontFamily: `"${estilo.tipografia.titulos}", sans-serif`, fontWeight: 800, fontSize: size * 1.15, lineHeight: 1.05, color: estilo.paleta.texto, opacity: e1, translate: `0 ${(1 - e1) * 30}px` }}>{o.texto ?? cliente.nombre}</div>
      {o.subtexto ? <div style={{ background: estilo.paleta.acento, color: textoSobre(estilo.paleta.acento), fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 800, fontSize: size * 0.4, letterSpacing: size * 0.05, padding: `${size * 0.14}px ${size * 0.4}px`, borderRadius: 999, opacity: e1 }}>{o.subtexto}</div> : null}
      <div style={{ marginTop: size * 0.3, background: estilo.paleta.texto, color: "#0b0b0b", fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 800, fontSize: size * 0.6, padding: `${size * 0.28}px ${size * 0.8}px`, borderRadius: 999, opacity: e2, scale: (0.85 + 0.15 * e2) * latido, boxShadow: `0 0 0 ${size * 0.08}px ${estilo.paleta.acento}88` }}>{cliente.cta} →</div>
      <div style={{ opacity: e3, fontFamily: `"${estilo.tipografia.cuerpo}", sans-serif`, fontWeight: 600, fontSize: size * 0.4, color: estilo.paleta.texto, lineHeight: 1.5 }}>
        {lineas.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </AbsoluteFill>
  );
};
