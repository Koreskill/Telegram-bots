import "./index.css";
import { Composition } from "remotion";
import { Edicion, calculateMetadata } from "./Edicion";
import { ejemplo } from "./ejemplo";

/** Composición única "Edicion": el bot la renderiza con `remotion render ... --props=<json>`. */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Edicion"
      component={Edicion}
      durationInFrames={Math.round((ejemplo.plan.video.duracion_s + ejemplo.plan.salida.extension_final_s) * 30)}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={ejemplo}
      calculateMetadata={calculateMetadata}
    />
  );
};
