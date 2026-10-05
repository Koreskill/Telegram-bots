import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { EdicionProps, Insert } from "../types";

/** Imagen insertada con movimiento suave (Ken Burns), a pantalla completa o como panel. */
export const InsertImagen: React.FC<{ ins: Insert; durFrames: number; estilo: EdicionProps["estilo"] }> = ({ ins, durFrames, estilo }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacidad = interpolate(frame, [0, 6, Math.max(7, durFrames - 6), durFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let scale = 1;
  let x = 0;
  switch (ins.movimiento) {
    case "zoom_in": scale = 1 + 0.08 * t; break;
    case "zoom_out": scale = 1.08 - 0.08 * t; break;
    case "paneo_izq": scale = 1.1; x = interpolate(t, [0, 1], [3, -3]); break;
    case "paneo_der": scale = 1.1; x = interpolate(t, [0, 1], [-3, 3]); break;
    default: break;
  }
  const img = <Img src={staticFile(ins.imagen)} style={{ width: "100%", height: "100%", objectFit: "cover", scale, translate: `${x}% 0` }} />;
  if (ins.modo === "pantalla_completa") return <AbsoluteFill style={{ opacity: opacidad, overflow: "hidden", background: "#000" }}>{img}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ opacity: opacidad, alignItems: "center", justifyContent: "center", filter: `contrast(${estilo.color.contraste})` }}>
      <div style={{ width: "84%", height: "56%", borderRadius: 36, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.55)", border: `4px solid ${estilo.paleta.acento}` }}>{img}</div>
    </AbsoluteFill>
  );
};
