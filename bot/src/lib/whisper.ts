import fs from "node:fs/promises";
import path from "node:path";
import { agruparPalabras, type Palabra, type Transcripcion } from "./transcripcion.js";

export interface Transcriber {
  transcribe(wav16k: string, o: { idioma: string; modelo: string; dir: string; signal?: AbortSignal; onProgress?: (p: number) => void }): Promise<Transcripcion>;
}

const WHISPER_CPP_VERSION = "1.5.5";

/**
 * whisper.cpp en CPU vía @remotion/install-whisper-cpp. La primera vez compila whisper.cpp
 * (necesita cmake + compilador, incluidos en el Dockerfile) y descarga el modelo (~1,5 GB para "medium"),
 * así que conviene precalentarlo con `npm run prewarm-whisper`.
 */
export class WhisperCppTranscriber implements Transcriber {
  async prepare(dir: string, modelo: string, signal?: AbortSignal): Promise<{ whisperPath: string; modelFolder: string }> {
    const mod = await import("@remotion/install-whisper-cpp");
    const whisperPath = path.join(dir, "whisper.cpp");
    const modelFolder = path.join(whisperPath, "models");
    await fs.mkdir(dir, { recursive: true });
    await mod.installWhisperCpp({ to: whisperPath, version: WHISPER_CPP_VERSION, printOutput: false, signal });
    await mod.downloadWhisperModel({ model: modelo as never, folder: modelFolder, printOutput: false, signal });
    return { whisperPath, modelFolder };
  }

  async transcribe(wav16k: string, o: { idioma: string; modelo: string; dir: string; signal?: AbortSignal; onProgress?: (p: number) => void }): Promise<Transcripcion> {
    const mod = await import("@remotion/install-whisper-cpp");
    const { whisperPath, modelFolder } = await this.prepare(o.dir, o.modelo, o.signal);
    const json = await mod.transcribe({
      inputPath: wav16k,
      whisperPath,
      whisperCppVersion: WHISPER_CPP_VERSION,
      model: o.modelo as never,
      modelFolder,
      tokenLevelTimestamps: true,
      language: o.idioma.slice(0, 2) as never,
      splitOnWord: true,
      signal: o.signal,
      onProgress: o.onProgress,
    });
    const { captions } = mod.toCaptions({ whisperCppOutput: json });
    return { idioma: o.idioma, palabras: agruparPalabras(captions) };
  }
}

/** Transcriptor de pruebas: reparte las palabras de un texto a 0,4 s por palabra. */
export class MockTranscriber implements Transcriber {
  constructor(private texto = "Hoy vengo a conocer el barrio privado Finca Dos con su laguna y sus canchas de pádel") {}
  async transcribe(): Promise<Transcripcion> {
    const palabras: Palabra[] = this.texto.split(/\s+/).map((texto, i) => ({ texto, inicio_ms: i * 400, fin_ms: i * 400 + 360 }));
    return { idioma: "es", palabras };
  }
}
