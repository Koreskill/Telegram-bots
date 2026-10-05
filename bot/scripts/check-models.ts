/**
 * Valida contra OpenRouter que los MODEL_* del entorno existan y soporten la modalidad
 * requerida; imprime precios. Uso: `npm run check-models` (necesita internet).
 */
import { z } from "zod";

const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  architecture: z
    .object({ input_modalities: z.array(z.string()).default([]), output_modalities: z.array(z.string()).default([]) })
    .default({ input_modalities: [], output_modalities: [] }),
  pricing: z.record(z.string(), z.unknown()).default({}),
  supported_parameters: z.array(z.string()).default([]),
});
const listSchema = z.object({ data: z.array(modelSchema) });

interface Check {
  env: string;
  need: { out?: string; in?: string; param?: string[] };
}
const CHECKS: Check[] = [
  { env: "MODEL_EXTRACT", need: { out: "text", param: ["response_format"] } },
  { env: "MODEL_TEXT", need: { out: "text", param: ["response_format"] } },
  { env: "MODEL_VISION", need: { in: "image", out: "text" } },
  { env: "MODEL_IMAGE", need: { in: "image", out: "image" } },
  { env: "MODEL_TTS", need: { out: "audio" } },
];
const DEFAULTS: Record<string, string> = {
  MODEL_EXTRACT: "google/gemini-2.5-flash",
  MODEL_TEXT: "anthropic/claude-sonnet-4.5",
  MODEL_VISION: "google/gemini-2.5-flash",
  MODEL_IMAGE: "google/gemini-2.5-flash-image",
  MODEL_TTS: "openai/gpt-audio-mini",
};

const res = await fetch("https://openrouter.ai/api/v1/models", {
  headers: process.env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : {},
});
if (!res.ok) {
  console.error(`OpenRouter respondió ${res.status}`);
  process.exit(2);
}
const models = new Map(listSchema.parse(await res.json()).data.map((m) => [m.id, m]));

let failed = 0;
for (const c of CHECKS) {
  const id = process.env[c.env] || DEFAULTS[c.env]!;
  const m = models.get(id);
  if (!m) {
    console.log(`❌ ${c.env}=${id}: no existe en OpenRouter`);
    failed++;
    continue;
  }
  const problems: string[] = [];
  if (c.need.out && !m.architecture.output_modalities.includes(c.need.out)) problems.push(`no produce ${c.need.out}`);
  if (c.need.in && !m.architecture.input_modalities.includes(c.need.in)) problems.push(`no acepta ${c.need.in}`);
  for (const p of c.need.param ?? [])
    if (!m.supported_parameters.includes(p)) problems.push(`no soporta ${p}`);
  const price = Object.entries(m.pricing)
    .filter(([, v]) => (typeof v === "string" || typeof v === "number") && Number(v) > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`${problems.length ? "❌" : "✅"} ${c.env}=${id} ${problems.join(", ")}\n     precios (USD): ${price || "n/d"}`);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
