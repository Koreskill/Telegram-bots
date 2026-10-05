/** Compila whisper.cpp y descarga el modelo (se ejecuta en el build de la imagen Docker). */
import path from "node:path";
import { WhisperCppTranscriber } from "../src/lib/whisper.js";

const dir = process.env.WHISPER_DIR || path.join(process.env.DATA_DIR ?? "./data", "whisper");
const modelo = process.env.WHISPER_MODEL ?? "medium";
console.log(`Preparando whisper.cpp (${modelo}) en ${dir}…`);
await new WhisperCppTranscriber().prepare(dir, modelo);
console.log("✅ whisper.cpp listo");
