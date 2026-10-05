import { z } from "zod";
import type { Config } from "../config.js";
import { LlmError, type ImageRequest, type JsonRequest, type Llm, type Part, type SpeechRequest } from "./types.js";

const BASE = "https://openrouter.ai/api/v1";

type Fetch = typeof fetch;
type Msg = { role: "system" | "user" | "assistant"; content: unknown };

function toContent(user: string | Part[]): unknown {
  if (typeof user === "string") return user;
  return user.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } },
  );
}

/** Quita ```json … ``` y recorta al primer objeto/array JSON si el modelo agregó texto. */
export function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = (fence?.[1] ?? raw).trim();
  const start = s.search(/[{[]/);
  if (start < 0) return s;
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  return end > start ? s.slice(start, end + 1) : s.slice(start);
}

export class OpenRouterClient implements Llm {
  constructor(
    private cfg: Pick<Config, "OPENROUTER_API_KEY" | "OPENROUTER_REFERER" | "OPENROUTER_TITLE">,
    private fetchImpl: Fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      ...(this.cfg.OPENROUTER_REFERER ? { "HTTP-Referer": this.cfg.OPENROUTER_REFERER } : {}),
      ...(this.cfg.OPENROUTER_TITLE ? { "X-Title": this.cfg.OPENROUTER_TITLE } : {}),
    };
  }

  /** POST /chat/completions con reintentos ante 408/429/5xx (respeta Retry-After). */
  private async post(body: Record<string, unknown>, o: { signal?: AbortSignal; timeoutMs?: number; tries?: number } = {}): Promise<Response> {
    const tries = o.tries ?? 4;
    let last: LlmError | undefined;
    for (let i = 0; i < tries; i++) {
      o.signal?.throwIfAborted();
      const signals = [AbortSignal.timeout(o.timeoutMs ?? 120_000), ...(o.signal ? [o.signal] : [])];
      let res: Response;
      try {
        res = await this.fetchImpl(`${BASE}/chat/completions`, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: AbortSignal.any(signals) });
      } catch (e) {
        if (o.signal?.aborted) throw e;
        last = new LlmError(`Red/timeout: ${e instanceof Error ? e.message : e}`);
        await this.sleep(1000 * 2 ** i);
        continue;
      }
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      last = new LlmError(`OpenRouter ${res.status}: ${text.slice(0, 300)}`, res.status);
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw last;
      const ra = Number(res.headers.get("retry-after"));
      await this.sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** i);
    }
    throw last ?? new LlmError("OpenRouter: sin respuesta");
  }

  async json<T>(r: JsonRequest<T>): Promise<{ data: T; costUsd: number }> {
    const jsonSchema = z.toJSONSchema(r.schema) as Record<string, unknown>;
    delete jsonSchema["$schema"];
    const messages: Msg[] = [
      { role: "system", content: r.system },
      { role: "user", content: toContent(r.user) },
    ];
    let cost = 0;
    const retries = r.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const res = await this.post(
        {
          model: r.model,
          messages,
          temperature: r.temperature ?? 0.1,
          response_format: { type: "json_schema", json_schema: { name: r.name, strict: true, schema: jsonSchema } },
          usage: { include: true },
        },
        { signal: r.signal },
      );
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
      cost += j.usage?.cost ?? 0;
      const content = j.choices?.[0]?.message?.content ?? "";
      let issue: string;
      try {
        const parsed = r.schema.safeParse(JSON.parse(extractJson(content)));
        if (parsed.success) return { data: parsed.data, costUsd: cost };
        issue = parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
      } catch (e) {
        issue = `JSON inválido (${e instanceof Error ? e.message : e})`;
      }
      if (attempt >= retries) throw new LlmError(`La salida del modelo no cumple el esquema "${r.name}": ${issue}`);
      messages.push({ role: "assistant", content }, { role: "user", content: `Tu respuesta no es válida: ${issue}. Respondé SOLO el JSON corregido, sin texto extra.` });
    }
  }

  async image(r: ImageRequest): Promise<{ png: Buffer; costUsd: number }> {
    const res = await this.post(
      {
        model: r.model,
        messages: [{ role: "user", content: toContent([{ type: "text", text: r.prompt }, { type: "image", base64: r.imageBase64, mime: r.mime }]) }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: r.aspectRatio },
        usage: { include: true },
      },
      { signal: r.signal, timeoutMs: 180_000 },
    );
    const j = (await res.json()) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[]; content?: unknown } }[];
      usage?: { cost?: number };
    };
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const m = url?.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
    if (!m) throw new LlmError("El modelo no devolvió una imagen (rechazo o respuesta solo de texto)");
    return { png: Buffer.from(m[1]!, "base64"), costUsd: j.usage?.cost ?? 0 };
  }

  async speech(r: SpeechRequest): Promise<{ pcm: Buffer; costUsd: number }> {
    const res = await this.post(
      {
        model: r.model,
        messages: [
          { role: "system", content: r.instructions },
          { role: "user", content: r.text },
        ],
        modalities: ["text", "audio"],
        audio: { voice: r.voice, format: "pcm16" },
        stream: true,
        usage: { include: true },
      },
      { signal: r.signal, timeoutMs: 180_000 },
    );
    const chunks: Buffer[] = [];
    let cost = 0;
    let buf = "";
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += Buffer.from(part).toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data) as { choices?: { delta?: { audio?: { data?: string } } }[]; usage?: { cost?: number } };
          const b64 = ev.choices?.[0]?.delta?.audio?.data;
          if (b64) chunks.push(Buffer.from(b64, "base64"));
          if (ev.usage?.cost) cost = ev.usage.cost;
        } catch {
          /* línea parcial o keep-alive */
        }
      }
    }
    if (chunks.length === 0) throw new LlmError("El modelo no devolvió audio");
    return { pcm: Buffer.concat(chunks), costUsd: cost };
  }
}
