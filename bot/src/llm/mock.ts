import sharp from "sharp";
import { LlmError, type ImageRequest, type JsonRequest, type Llm, type SpeechRequest } from "./types.js";

/**
 * LLM de pruebas (MOCK=1): no gasta créditos ni usa red. Las respuestas JSON salen de `req.mock()`
 * (definido por cada agente) y se validan igual que las reales, así los tests ejercitan el mismo camino.
 */
export class MockLlm implements Llm {
  calls = { json: 0, image: 0, speech: 0 };

  async json<T>(r: JsonRequest<T>): Promise<{ data: T; costUsd: number }> {
    this.calls.json++;
    if (!r.mock) throw new LlmError(`MOCK=1 pero "${r.name}" no define mock()`);
    return { data: r.schema.parse(r.mock()), costUsd: 0 };
  }

  async image(r: ImageRequest): Promise<{ png: Buffer; costUsd: number }> {
    this.calls.image++;
    const [a, b] = r.aspectRatio.split(":").map(Number) as [number, number];
    const w = 720;
    const h = Math.round((w * b) / a);
    const png = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 90, b: 70 } } }).png().toBuffer();
    return { png, costUsd: 0 };
  }

  async speech(r: SpeechRequest): Promise<{ pcm: Buffer; costUsd: number }> {
    this.calls.speech++;
    const words = r.text.trim().split(/\s+/).length;
    const seconds = Math.max(0.5, words * 0.4);
    return { pcm: Buffer.alloc(Math.round(seconds * 24000) * 2), costUsd: 0 };
  }
}
