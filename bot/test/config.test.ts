import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { TELEGRAM_BOT_TOKEN: "123456:ABCDEF", TELEGRAM_ALLOWED_IDS: "111, 222", OPENROUTER_API_KEY: "sk", NODE_ENV: "development" };

describe("loadConfig", () => {
  it("parsea ids y aplica defaults", () => {
    const c = loadConfig(base);
    expect(c.TELEGRAM_ALLOWED_IDS).toEqual([111, 222]);
    expect(c.MODEL_IMAGE).toBe("google/gemini-2.5-flash-image");
    expect(c.MAX_USD_PER_PROJECT).toBe(5);
    expect(c.MOCK).toBe(false);
  });
  it("falla si falta el token y lista todos los errores", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_ALLOWED_IDS|TELEGRAM_ALLOWED_IDS[\s\S]*TELEGRAM_BOT_TOKEN/);
  });
  it("rechaza ids no numéricos", () => {
    expect(() => loadConfig({ ...base, TELEGRAM_ALLOWED_IDS: "abc" })).toThrow(/ids numéricos/);
  });
  it("OPENROUTER_API_KEY es opcional solo con MOCK=1", () => {
    const { OPENROUTER_API_KEY: _omit, ...sin } = base;
    expect(() => loadConfig(sin)).toThrow(/OPENROUTER_API_KEY/);
    expect(loadConfig({ ...sin, MOCK: "1" }).MOCK).toBe(true);
  });
  it("en producción exige secreto y ruta de webhook", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    const ok = loadConfig({
      ...base,
      NODE_ENV: "production",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(20),
      TELEGRAM_WEBHOOK_PATH: "b".repeat(20),
    });
    expect(ok.NODE_ENV).toBe("production");
  });
});
