import type { z } from "zod";

export type Part = { type: "text"; text: string } | { type: "image"; base64: string; mime: string };

export interface JsonRequest<T> {
  model: string;
  system: string;
  user: string | Part[];
  /** Nombre del esquema (para response_format). */
  name: string;
  schema: z.ZodType<T>;
  temperature?: number;
  /** Reintentos si la salida no valida contra zod (por defecto 2). */
  maxRetries?: number;
  /** Solo para MOCK=1: construye una respuesta determinista y válida. */
  mock?: () => T;
  signal?: AbortSignal;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  imageBase64: string;
  mime: string;
  aspectRatio: string;
  signal?: AbortSignal;
}

export interface SpeechRequest {
  model: string;
  voice: string;
  text: string;
  instructions: string;
  signal?: AbortSignal;
}

export interface Llm {
  json<T>(r: JsonRequest<T>): Promise<{ data: T; costUsd: number }>;
  image(r: ImageRequest): Promise<{ png: Buffer; costUsd: number }>;
  /** PCM 16-bit little-endian, 24 kHz, mono. */
  speech(r: SpeechRequest): Promise<{ pcm: Buffer; costUsd: number }>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
