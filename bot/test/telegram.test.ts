import { beforeEach, describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { Bot } from "grammy";
import { createBot } from "../src/telegram/bot.js";
import { Worker } from "../src/queue/queue.js";
import { splitText } from "../src/telegram/text.js";
import { createProject, readManifest, setAgente } from "../src/project/manifest.js";
import { crearCliente, makeEnv, makeVideo, type Env } from "./helpers.js";

const OWNER = 1;
let env: Env;
let bot: Bot;
let calls: { method: string; payload: any }[];
let cliente: string;

beforeEach(async () => {
  env = await makeEnv();
  cliente = await crearCliente(env, "Cliente Uno");
  await createProject(env.paths, cliente, "casa-1");
  bot = createBot({ config: env.deps.config, paths: env.paths, store: env.store, worker: new Worker(env.store) });
  bot.botInfo = { id: 1, is_bot: true, first_name: "t", username: "t_bot" } as any;
  calls = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === "getFile") return { ok: true, result: { file_id: "f", file_path: (globalThis as any).__tgFile } } as any;
    return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 1 } } : true } as any;
  });
});
afterEach(() => env.cleanup());

const msg = (from: number, text: string, id = 1) =>
  ({
    update_id: id,
    message: { message_id: id, date: 0, chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "x" }, text,
      entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : undefined },
  }) as any;
const cb = (data: string, id = 1) =>
  ({ update_id: id, callback_query: { id: String(id), from: { id: OWNER, is_bot: false, first_name: "x" }, chat_instance: "c", data,
    message: { message_id: 9, date: 0, chat: { id: OWNER, type: "private" }, text: "x" } } }) as any;
const texts = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
const jobs = () => env.store.list(["queued", "running"], 20).reverse();
const activar = () => env.store.setChatState(OWNER, { cliente, proyecto: "casa-1" });

describe("seguridad y navegación", () => {
  it("lista blanca: un usuario ajeno no recibe NADA ni encola nada", async () => {
    await bot.handleUpdate(msg(999, "/start"));
    await bot.handleUpdate(msg(999, "/capturar https://x.com", 2));
    await bot.handleUpdate(msg(999, "https://x.com", 3));
    expect(calls).toEqual([]);
    expect(jobs()).toEqual([]);
  });
  it("/start y /ayuda listan la ruta de agentes y las skills", async () => {
    await bot.handleUpdate(msg(OWNER, "/start"));
    expect(texts()[0]).toContain("/capturar");
    await bot.handleUpdate(msg(OWNER, "/ayuda", 2));
    const t = texts().at(-1)!;
    for (const x of ["capturar", "imagenes", "prompts", "extender", "guion", "voz", "estilo", "video", "publicar"]) expect(t).toContain(x);
    expect(t).toContain("/capturar &lt;url&gt;");
  });
  it("/cliente lista clientes reales con callback_data <= 64 bytes y /estado muestra la tabla", async () => {
    await bot.handleUpdate(msg(OWNER, "/cliente"));
    const kb = calls[0]!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.map((b: any) => b.text)).toEqual(["Cliente Uno"]);
    expect(Buffer.byteLength(kb[0].callback_data)).toBeLessThanOrEqual(64);
    await bot.handleUpdate(msg(OWNER, "/estado", 2));
    expect(texts().at(-1)).toMatch(/Elegí cliente y proyecto/);
    activar();
    await bot.handleUpdate(msg(OWNER, "/estado", 3));
    expect(texts().at(-1)).toContain("Cliente Uno / casa-1");
    expect(texts().at(-1)).toContain("6 Video");
  });
  it("/nuevocliente crea la carpeta con cliente.json y rechaza nombres peligrosos", async () => {
    await bot.handleUpdate(msg(OWNER, "/nuevocliente Inmobiliaria Peña"));
    await expect(fs.stat(path.join(env.paths.clienteDir("Inmobiliaria Peña"), "proyectos"))).resolves.toBeTruthy();
    expect(JSON.parse(await fs.readFile(env.paths.clienteJson("Inmobiliaria Peña"), "utf8")).nombre).toBe("Inmobiliaria Peña");
    expect(env.store.getChatState(OWNER).cliente).toBe("Inmobiliaria Peña");
    await bot.handleUpdate(msg(OWNER, "/nuevocliente ../../etc", 2));
    expect(texts().at(-1)).toMatch(/Nombre no permitido/);
    await expect(fs.stat(path.join(env.dir, "etc"))).rejects.toBeTruthy();
    await bot.handleUpdate(msg(OWNER, "/nuevocliente Inmobiliaria Peña", 3));
    expect(texts().at(-1)).toMatch(/ya existe/);
  });
});

describe("triggers de agentes", () => {
  it("/capturar y URL pegada encolan el agente 1; sin cliente pide elegirlo", async () => {
    await bot.handleUpdate(msg(OWNER, "/capturar https://inmo.com/p/1"));
    expect(texts().at(-1)).toMatch(/elegí el cliente/i);
    expect(jobs()).toHaveLength(0);
    env.store.setChatState(OWNER, { cliente });
    await bot.handleUpdate(msg(OWNER, "/capturar https://inmo.com/p/1", 2));
    await bot.handleUpdate(msg(OWNER, "https://inmo.com/p/2", 3));
    const j = jobs();
    expect(j.map((x) => x.tipo)).toEqual(["capturar", "capturar"]);
    expect(j[0]!.payload).toEqual({ args: { url: "https://inmo.com/p/1", auto: false } });
    expect(j[0]!.cliente).toBe(cliente);
    await bot.handleUpdate(msg(OWNER, "/capturar https://inmo.com/p/3 NoExiste", 4));
    expect(texts().at(-1)).toMatch(/No existe el cliente/);
    await bot.handleUpdate(msg(OWNER, "/capturar no-es-url", 5));
    expect(texts().at(-1)).toMatch(/Uso: \/capturar/);
  });
  it("/todo marca auto=true", async () => {
    env.store.setChatState(OWNER, { cliente });
    await bot.handleUpdate(msg(OWNER, "/todo https://inmo.com/p/1"));
    expect(jobs()[0]!.payload).toEqual({ args: { url: "https://inmo.com/p/1", auto: true } });
  });
  it("comandos de proyecto sin proyecto activo piden elegirlo", async () => {
    for (const c of ["/imagenes", "/prompts", "/extender", "/guion", "/voz", "/video", "/publicar"]) await bot.handleUpdate(msg(OWNER, c, Math.random() * 1e6 | 0));
    expect(texts().every((t) => /Elegí cliente y proyecto/.test(t))).toBe(true);
    expect(jobs()).toHaveLength(0);
  });
  it("cada comando encola su agente con la clase y argumentos correctos", async () => {
    activar();
    const casos: [string, string, string, Record<string, unknown>][] = [
      ["/imagenes", "imagenes", "light", {}],
      ["/prompts --forzar", "prompts", "light", { forzar: true }],
      ["/extender 3 img_005", "extender", "heavy", { solo: ["img_003", "img_005"] }],
      ["/guion --voz", "guion", "heavy", { voz: true }],
      ["/voz", "voz", "heavy", {}],
      ["/video premium --final", "video", "heavy", { estilo: "premium", final: true }],
      ["/publicar", "publicar", "light", {}],
    ];
    let i = 10;
    for (const [c] of casos) await bot.handleUpdate(msg(OWNER, c, i++));
    const j = jobs();
    expect(j.map((x) => [x.tipo, x.clase, (x.payload as any).args])).toEqual(casos.map(([, t, cl, a]) => [t, cl, a]));
    expect(j.every((x) => x.cliente === cliente && x.proyecto === "casa-1" && x.chat_id === OWNER)).toBe(true);
  });
  it("/estilos y /cancelar", async () => {
    await bot.handleUpdate(msg(OWNER, "/estilos --forzar"));
    expect(jobs()[0]).toMatchObject({ tipo: "estilos", clase: "heavy" });
    await bot.handleUpdate(msg(OWNER, "/cancelar", 2));
    expect(texts().at(-1)).toMatch(/Cancelé 1/);
  });
});

describe("botones y respuestas pendientes", () => {
  it("next:<agente> encola el siguiente paso; guion_voz pide voz en off", async () => {
    activar();
    await bot.handleUpdate(cb("next:prompts"));
    await bot.handleUpdate(cb("next:guion_voz", 2));
    await bot.handleUpdate(cb("next:capturar", 3)); // no permitido por botón
    expect(jobs().map((j) => [j.tipo, (j.payload as any).args])).toEqual([["prompts", {}], ["guion", { voz: true }]]);
  });
  it("aprobar / regenerar / blur de una imagen", async () => {
    activar();
    await setAgente(env.paths, cliente, "casa-1", "extender", { estado: "done" });
    await fs.mkdir(env.paths.subdir(cliente, "casa-1", "extendidas"), { recursive: true });
    await fs.writeFile(path.join(env.paths.subdir(cliente, "casa-1", "extendidas"), "estado.json"), JSON.stringify({ img_001: { estado: "pendiente", metodo: "ia" } }));
    await bot.handleUpdate(cb("ok:img_001"));
    expect((await readManifest(env.paths, cliente, "casa-1")).agentes.extender.aprobadas).toEqual(["img_001"]);
    await bot.handleUpdate(cb("rg:img_001", 2));
    await bot.handleUpdate(cb("bl:img_001", 3));
    expect(jobs().map((j) => (j.payload as any).args)).toEqual([{ solo: ["img_001"] }, { solo: ["img_001"], blur: true }]);
    await bot.handleUpdate(cb("ok:../../etc", 4)); // no coincide con el patrón → ignorado
    expect(jobs()).toHaveLength(2);
  });
  it("editar prompt: botón → texto → archivo actualizado y marcado como editado", async () => {
    activar();
    const dir = env.paths.subdir(cliente, "casa-1", "prompts");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "img_001.json"), JSON.stringify({ archivo: "img_001.jpg", prompt_extension: "viejo prompt largo", editado: false }));
    await bot.handleUpdate(cb("ep:img_001"));
    expect(env.store.getPending(OWNER)).toMatchObject({ tipo: "editar_prompt", data: { img: "img_001" } });
    await bot.handleUpdate(msg(OWNER, "Extend the sky above with warm sunset clouds", 2));
    const j = JSON.parse(await fs.readFile(path.join(dir, "img_001.json"), "utf8"));
    expect(j.editado).toBe(true);
    expect(j.prompt_extension).toContain("sunset clouds");
    expect(j.prompt_extension).toMatch(/unchanged/i); // se le agrega la restricción
    expect(env.store.getPending(OWNER)).toBeUndefined();
  });
  it("pedir cambios al plan encola /guion con los cambios", async () => {
    activar();
    await bot.handleUpdate(cb("pl:cambios"));
    await bot.handleUpdate(msg(OWNER, "sacá el chip de la laguna", 2));
    expect(jobs()[0]).toMatchObject({ tipo: "guion" });
    expect((jobs()[0]!.payload as any).args).toEqual({ cambios: "sacá el chip de la laguna" });
  });
  it("corregir subtítulos exige la misma cantidad de palabras", async () => {
    activar();
    const dir = env.paths.subdir(cliente, "casa-1", "guion");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "transcripcion.json"), JSON.stringify({ idioma: "es", palabras: [{ texto: "hola", inicio_ms: 0, fin_ms: 100 }, { texto: "finka", inicio_ms: 100, fin_ms: 300 }] }));
    await bot.handleUpdate(cb("st:edit"));
    await bot.handleUpdate(msg(OWNER, "hola Finca Dos", 2));
    expect(texts().at(-1)).toMatch(/3 palabras y la transcripción 2/);
    await bot.handleUpdate(cb("st:edit", 3));
    await bot.handleUpdate(msg(OWNER, "hola Finca", 4));
    const t = JSON.parse(await fs.readFile(path.join(dir, "transcripcion.json"), "utf8"));
    expect(t.palabras.map((p: any) => [p.texto, p.inicio_ms])).toEqual([["hola", 0], ["Finca", 100]]);
    expect(await fs.readFile(path.join(dir, "subtitulos.srt"), "utf8")).toContain("hola Finca");
  });
  it("publicar: 'ahora' exige segunda confirmación; borrador y programar funcionan; cancelar no publica", async () => {
    activar();
    await bot.handleUpdate(cb("pub:ahora"));
    expect(texts().at(-1)).toMatch(/¿Confirmás publicar AHORA/);
    expect(jobs()).toHaveLength(0); // todavía nada
    await bot.handleUpdate(cb("pub:ahora_ok", 2));
    expect((jobs()[0]!.payload as any).args).toEqual({ modo: "ahora" });
    await bot.handleUpdate(cb("pub:borrador", 3));
    expect((jobs()[1]!.payload as any).args).toEqual({ modo: "borrador" });
    await bot.handleUpdate(cb("pub:prog", 4));
    await bot.handleUpdate(msg(OWNER, "ayer", 5));
    expect(texts().at(-1)).toMatch(/No entendí la fecha/);
    await bot.handleUpdate(cb("pub:prog", 6));
    await bot.handleUpdate(msg(OWNER, "2099-01-02 10:00", 7));
    expect((jobs()[2]!.payload as any).args).toEqual({ modo: "programar", fecha: "2099-01-02T10:00:00-03:00" });
    const n = jobs().length;
    await bot.handleUpdate(cb("pub:cancel", 8));
    expect(texts().at(-1)).toMatch(/No se publicó nada/);
    expect(jobs()).toHaveLength(n);
  });
});

describe("subida del video grabado", () => {
  it("guarda el documento de video en el proyecto activo y ofrece /guion", async () => {
    activar();
    const src = path.join(env.dir, "tg-local.mp4");
    await makeVideo(src, 3);
    (globalThis as any).__tgFile = src; // ruta absoluta = servidor Bot API local
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false, first_name: "x" }, document: { file_id: "f", file_unique_id: "u", file_name: "recorrido.MOV", mime_type: "video/quicktime" } } } as any);
    const dest = path.join(env.paths.subdir(cliente, "casa-1", "videoGrabado"), "original.mov");
    await expect(fs.stat(dest)).resolves.toBeTruthy();
    const t = texts().at(-1)!;
    expect(t).toMatch(/Video guardado: 640×360, 3 s/);
    const kb = calls.at(-1)!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(kb).toEqual(["next:guion", "next:guion_voz"]);
  });
  it("un archivo que no es video se rechaza y sin proyecto no guarda nada", async () => {
    activar();
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false, first_name: "x" }, document: { file_id: "f", file_unique_id: "u", file_name: "datos.pdf", mime_type: "application/pdf" } } } as any);
    expect(texts().at(-1)).toMatch(/no parece un video/);
  });
});

describe("splitText", () => {
  it("no parte textos cortos y respeta el máximo", () => {
    expect(splitText("hola")).toEqual(["hola"]);
    const parts = splitText("línea de prueba\n".repeat(1000));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("\n").replace(/\n/g, "")).toBe("línea de prueba\n".repeat(1000).replace(/\n/g, ""));
  });
});
