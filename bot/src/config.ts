import { z } from "zod";

const bool = z
  .enum(["0", "1", "true", "false", ""])
  .default("0")
  .transform((v) => v === "1" || v === "true");

const num = (def: number) =>
  z.preprocess((v) => (v === "" || v === undefined ? def : Number(v)), z.number().positive());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
    PORT: num(3000),
    DATA_DIR: z.string().min(1).default("/data"),
    MOCK: bool,

    TELEGRAM_BOT_TOKEN: z.string().min(10),
    TELEGRAM_ALLOWED_IDS: z
      .string()
      .min(1)
      .transform((s) => s.split(",").map((x) => Number(x.trim())))
      .refine((a) => a.length > 0 && a.every((n) => Number.isInteger(n) && n !== 0), {
        message: "TELEGRAM_ALLOWED_IDS debe ser una lista de ids numéricos separados por coma",
      }),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
    TELEGRAM_WEBHOOK_PATH: z.string().default(""),
    TELEGRAM_API_ROOT: z.string().default(""),
    PUBLIC_URL: z.string().default(""),

    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_REFERER: z.string().default(""),
    OPENROUTER_TITLE: z.string().default("Bot Inmobiliaria"),
    MODEL_EXTRACT: z.string().min(1).default("google/gemini-2.5-flash"),
    MODEL_TEXT: z.string().min(1).default("anthropic/claude-sonnet-4.5"),
    MODEL_VISION: z.string().min(1).default("google/gemini-2.5-flash"),
    MODEL_IMAGE: z.string().min(1).default("google/gemini-2.5-flash-image"),
    MODEL_TTS: z.string().min(1).default("openai/gpt-audio-mini"),
    TTS_VOICE: z.string().default("alloy"),

    MAX_USD_PER_PROJECT: num(5),
    MAX_USD_PER_DAY: num(20),
    WHISPER_MODEL: z.string().default("medium"),
    RENDER_CONCURRENCY: num(2),
    ZERNIO_API_KEY: z.string().default(""),
  })
  .superRefine((c, ctx) => {
    if (!c.MOCK && !c.OPENROUTER_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["OPENROUTER_API_KEY"], message: "obligatoria si MOCK=0" });
    }
    if (c.NODE_ENV === "production") {
      for (const k of ["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_PATH"] as const) {
        if (c[k].length < 16) {
          ctx.addIssue({ code: "custom", path: [k], message: "obligatoria en producción (mín. 16 caracteres)" });
        }
      }
      if (!/^[A-Za-z0-9_-]+$/.test(c.TELEGRAM_WEBHOOK_PATH)) {
        ctx.addIssue({ code: "custom", path: ["TELEGRAM_WEBHOOK_PATH"], message: "solo letras, números, _ y -" });
      }
    }
  });

export type Config = z.infer<typeof schema>;

/** Valida el entorno; lanza un error legible con TODAS las variables inválidas. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Configuración inválida:\n${lines.join("\n")}`);
  }
  return r.data;
}
