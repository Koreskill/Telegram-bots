import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Bot } from "grammy";
import { loadConfig } from "../src/config.js";
import { createPaths } from "../src/paths.js";
import { JobStore, Worker } from "../src/queue/queue.js";
import { createBot } from "../src/telegram/bot.js";
import { splitText } from "../src/telegram/text.js";
import { createProject } from "../src/project/manifest.js";

const OWNER = 111;
let bot: Bot;
let calls: { method: string; payload: any }[];
let store: JobStore;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-"));
  const paths = createPaths(dir);
  await fs.mkdir(paths.clienteDir("Cliente Uno"), { recursive: true });
  await createProject(paths, "Cliente Uno", "casa-1");
  store = new JobStore(":memory:");
  const config = loadConfig({
    NODE_ENV: "development", TELEGRAM_BOT_TOKEN: "123456:ABCDEF", TELEGRAM_ALLOWED_IDS: String(OWNER), MOCK: "1",
  });
  bot = createBot({ config, paths, store, worker: new Worker(store) });
  bot.botInfo = { id: 1, is_bot: true, first_name: "t", username: "t_bot" } as any;
  calls = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 1 } } : true } as any;
  });
});

const msg = (from: number, text: string, id = 1) => ({
  update_id: id,
  message: {
    message_id: id, date: 0, chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "x" }, text,
    entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : undefined,
  },
}) as any;

describe("telegram", () => {
  it("lista blanca: usuario ajeno no recibe NADA", async () => {
    await bot.handleUpdate(msg(999, "/start"));
    await bot.handleUpdate(msg(999, "/estado", 2));
    expect(calls).toEqual([]);
  });
  it("el dueño recibe respuesta", async () => {
    await bot.handleUpdate(msg(OWNER, "/start"));
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload.text).toContain("/cliente");
  });
  it("/cliente lista los clientes reales con callback_data <= 64 bytes", async () => {
    await bot.handleUpdate(msg(OWNER, "/cliente"));
    const kb = calls[0]!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.map((b: any) => b.text)).toEqual(["Cliente Uno"]);
    expect(Buffer.byteLength(kb[0].callback_data)).toBeLessThanOrEqual(64);
  });
  it("/estado sin proyecto activo pide elegirlo", async () => {
    await bot.handleUpdate(msg(OWNER, "/estado"));
    expect(calls[0]?.payload.text).toMatch(/Elegí cliente y proyecto/);
  });
  it("/estado muestra la tabla de agentes del proyecto activo", async () => {
    store.setChatState(OWNER, { cliente: "Cliente Uno", proyecto: "casa-1" });
    await bot.handleUpdate(msg(OWNER, "/estado"));
    const t: string = calls[0]!.payload.text;
    expect(t).toContain("Cliente Uno / casa-1");
    expect(t).toContain("1 Capturar");
    expect(t).toContain("6 Video");
  });
  it("agentes aún no implementados responden con su fase", async () => {
    await bot.handleUpdate(msg(OWNER, "/extender"));
    expect(calls[0]?.payload.text).toMatch(/Fase 4/);
  });
});

describe("splitText", () => {
  it("no parte textos cortos y respeta el máximo", () => {
    expect(splitText("hola")).toEqual(["hola"]);
    const parts = splitText(("línea de prueba\n").repeat(1000));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("\n").replace(/\n/g, "")).toBe(("línea de prueba\n").repeat(1000).replace(/\n/g, ""));
  });
});
