import React from "react";
import { AbsoluteFill, Freeze, Sequence, useCurrentFrame, useVideoConfig, interpolate, staticFile, useDelayRender, type CalculateMetadataFunction } from "remotion";
import { Audio, Video } from "@remotion/media";
import { loadFont } from "@remotion/fonts";
import type { EdicionProps } from "./types";
import { Subtitulos } from "./components/Subtitulos";
import { OverlayView } from "./components/Overlays";
import { TarjetaFinal } from "./components/TarjetaFinal";
import { InsertImagen } from "./components/InsertImagen";
import { paginas } from "./lib/anim";

export const calculateMetadata: CalculateMetadataFunction<EdicionProps> = ({ props }) => {
  const { plan } = props;
  const fps = plan.salida.fps;
  return {
    fps,
    width: plan.salida.ancho,
    height: plan.salida.alto,
    durationInFrames: Math.max(1, Math.round((plan.video.duracion_s + plan.salida.extension_final_s) * fps)),
  };
};

/** Carga las fuentes del cliente/estilo antes de renderizar el primer fotograma. */
function useFuentes(fuentes: EdicionProps["fuentes"]) {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = React.useState(() => (fuentes.length ? delayRender("fuentes") : null));
  React.useEffect(() => {
    if (handle === null) return;
    Promise.all(fuentes.map((f) => loadFont({ family: f.nombre, url: staticFile(f.archivo), weight: "100 900" })))
      .catch(() => undefined)
      .finally(() => continueRender(handle));
  }, [handle, fuentes, continueRender]);
}

/**
 * Capas (de abajo hacia arriba): video real → inserts de imágenes → viñeta → overlays de motion graphics
 * → subtítulos → tarjeta final. Audio: voz original, voz en off y música con ducking.
 * TODO valor visual sale de `estilo` y `cliente`; nada de diseño está fijo en el código.
 */
export const Edicion: React.FC<EdicionProps> = ({ plan, estilo, cliente, palabras, fuentes }) => {
  useFuentes(fuentes);
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const durVideo = Math.round(plan.video.duracion_s * fps);
  const ext = Math.round(plan.salida.extension_final_s * fps);
  const total = durVideo + ext;
  const relacionOrigen = plan.video.ancho / plan.video.alto;
  const relacionSalida = width / height;
  const cubre = Math.abs(relacionOrigen - relacionSalida) < 0.08; // misma proporción → cover; si no, contener sobre fondo desenfocado
  const ms = (frame / fps) * 1000;
  const pgs = React.useMemo(() => paginas(palabras, plan.captions.grupo_palabras[0], plan.captions.grupo_palabras[1]), [palabras, plan.captions.grupo_palabras]);
  const hablando = pgs.some((p) => ms >= p[0]!.inicio_ms - 200 && ms <= p[p.length - 1]!.fin_ms + 300);
  const hayVo = plan.vo.some((v) => v.archivo && v.duracion_s && frame >= v.inicio * fps && frame <= (v.inicio + v.duracion_s) * fps);
  const volMusica = plan.musica.volumen * (plan.musica.ducking && (hablando || hayVo) ? 0.45 : 1);
  const src = staticFile(plan.video.archivo);

  // Cada video va en su propio AbsoluteFill: AbsoluteFill es flex en columna y, si no, se apilarían.
  const videoLayer = (extra: { muted?: boolean; trimBefore?: number } = {}) => (
    <>
      {!cubre ? (
        <AbsoluteFill>
          <Video src={src} muted objectFit="cover" style={{ width: "100%", height: "100%", filter: "blur(40px) brightness(.55)", scale: 1.15 }} {...extra} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill>
        <Video src={src} objectFit={cubre ? "cover" : "contain"} style={{ width: "100%", height: "100%" }} {...extra} />
      </AbsoluteFill>
    </>
  );

  return (
    <AbsoluteFill style={{ background: estilo.paleta.fondo }}>
      {/* 1 · video real */}
      <Sequence durationInFrames={Math.max(1, durVideo)} premountFor={fps}>
        <AbsoluteFill style={{ filter: `contrast(${estilo.color.contraste})` }}>{videoLayer()}</AbsoluteFill>
      </Sequence>
      {ext > 0 ? (
        <Sequence from={durVideo} durationInFrames={ext} premountFor={fps}>
          <Freeze frame={0}>
            <AbsoluteFill>{videoLayer({ muted: true, trimBefore: Math.max(0, durVideo - 2) })}</AbsoluteFill>
          </Freeze>
        </Sequence>
      ) : null}

      {/* 2 · inserts */}
      {plan.inserts.map((ins) => (
        <Sequence key={ins.id} from={Math.round(ins.inicio * fps)} durationInFrames={Math.max(1, Math.round((ins.fin - ins.inicio) * fps))} premountFor={fps}>
          <InsertImagen ins={ins} durFrames={Math.max(1, Math.round((ins.fin - ins.inicio) * fps))} estilo={estilo} />
        </Sequence>
      ))}

      {/* 3 · viñeta */}
      {estilo.color.vineta > 0 ? <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${estilo.color.vineta}) 100%)`, pointerEvents: "none" }} /> : null}

      {/* 4 · motion graphics */}
      {plan.overlays.filter((o) => o.tipo !== "tarjeta_final").map((o) => {
        const d = Math.max(1, Math.round((o.fin - o.inicio) * fps));
        return (
          <Sequence key={o.id} from={Math.round(o.inicio * fps)} durationInFrames={d} premountFor={fps}>
            <OverlayView o={o} durFrames={d} estilo={estilo} ancho={width} alto={height} />
          </Sequence>
        );
      })}

      {/* 5 · subtítulos (se apagan en la tarjeta final) */}
      <Sequence durationInFrames={Math.max(1, durVideo)}>
        <Subtitulos palabras={palabras} estilo={estilo} grupo={plan.captions.grupo_palabras} alto={height} />
      </Sequence>

      {/* 6 · tarjeta final */}
      {plan.overlays.filter((o) => o.tipo === "tarjeta_final").map((o) => {
        const d = Math.max(1, Math.round((o.fin - o.inicio) * fps));
        return (
          <Sequence key={o.id} from={Math.round(o.inicio * fps)} durationInFrames={Math.min(d, Math.max(1, total - Math.round(o.inicio * fps)))} premountFor={fps}>
            <TarjetaFinal o={o} durFrames={d} estilo={estilo} cliente={cliente} alto={height} />
          </Sequence>
        );
      })}

      {/* audio: voz en off + música */}
      {plan.vo.filter((v) => v.archivo).map((v) => (
        <Audio key={v.id} src={staticFile(v.archivo!)} from={Math.round(v.inicio * fps)} premountFor={fps} />
      ))}
      {plan.musica.archivo ? (
        <Audio src={staticFile(plan.musica.archivo)} loop volume={interpolate(frame, [0, fps, total - fps, total], [0, volMusica, volMusica, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      ) : null}
    </AbsoluteFill>
  );
};
