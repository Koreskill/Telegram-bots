import { Bot, InlineKeyboard, type Context } from "grammy";
import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import type { Paths } from "../paths.js";
import { AGENTES, listClients, listProjects, readManifest, type AgenteId } from "../project/manifest.js";
import type { JobStore, Worker } from "../queue/queue.js";
import { escapeHtml, splitText } from "./text.js";

export interface BotDeps {
  config: Config;
  paths: Paths;
  store: JobStore;
  worker: Worker;
}

const short = (name: string) => createHash("sha1").update(name).digest("hex").slice(0, 8);
const MAX_BUTTONS = 40;

const ICON: Record<string, string> = { pending: "⚪", running: "🔄", done: "✅", error: "❌", skipped: "⏭" };
const LABEL: Record<AgenteId, string> = {
  capturar: "1 Capturar",
  imagenes: "2 Imágenes",
  prompts: "3 Prompts",
  extender: "4 Extender",
  guion: "5 Guion",
  voz: "5b Voz",
  video: "6 Video",
  publicar: "9 Publicar",
};

/** Comandos de agentes que se implementan en fases posteriores. */
const PENDIENTES: Record<string, string> = {
  capturar: "Fase 2",
  imagenes: "Fase 2",
  prompts: "Fase 3",
  extender: "Fase 4",
  subir: "Fase 5",
  guion: "Fase 5",
  voz: "Fase 5b",
  estilos: "Fase 6",
  video: "Fase 6",
  todo: "Fase 7",
  publicar: "Fase 9",
};

export function createBot(deps: BotDeps): Bot {
  const { config, paths, store, worker } = deps;
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN, {
    client: config.TELEGRAM_API_ROOT ? { apiRoot: config.TELEGRAM_API_ROOT } : undefined,
  });

  // Lista blanca: todo lo que no venga de un id autorizado se ignora en silencio.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id === undefined || !config.TELEGRAM_ALLOWED_IDS.includes(id)) return;
    await next();
  });

  const reply = async (ctx: Context, text: string, extra: Parameters<Context["reply"]>[1] = {}) => {
    for (const part of splitText(text)) await ctx.reply(part, extra);
  };

  bot.command("start", (ctx) =>
    reply(
      ctx,
      [
        "<b>Bot inmobiliario</b>",
        "",
        "/cliente — elegir cliente",
        "/proyecto — elegir proyecto del cliente",
        "/estado — progreso del proyecto activo",
        "/cancelar — detener lo que esté corriendo",
        "",
        "Agentes (se habilitan por fases): /capturar /imagenes /prompts /extender /guion /voz /video",
      ].join("\n"),
      { parse_mode: "HTML" },
    ),
  );

  bot.command("cliente", async (ctx) => {
    const clients = await listClients(paths);
    if (clients.length === 0) return ctx.reply(`No encontré clientes en ${paths.clientesDir}`);
    const kb = new InlineKeyboard();
    for (const c of clients.slice(0, MAX_BUTTONS)) kb.text(c, `cl:${short(c)}`).row();
    const extra = clients.length > MAX_BUTTONS ? `\n(mostrando ${MAX_BUTTONS} de ${clients.length})` : "";
    await ctx.reply(`Elegí el cliente:${extra}`, { reply_markup: kb });
  });

  bot.callbackQuery(/^cl:([0-9a-f]{8})$/, async (ctx) => {
    const clients = await listClients(paths);
    const name = clients.find((c) => short(c) === ctx.match[1]);
    if (!name) return ctx.answerCallbackQuery({ text: "Ya no existe ese cliente", show_alert: true });
    store.setChatState(ctx.from.id, { cliente: name, proyecto: null });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Cliente activo: ${name}\nUsá /proyecto para elegir un proyecto.`);
  });

  bot.command("proyecto", async (ctx) => {
    const { cliente } = store.getChatState(ctx.from!.id);
    if (!cliente) return ctx.reply("Primero elegí un cliente con /cliente");
    const projects = await listProjects(paths, cliente);
    if (projects.length === 0) return ctx.reply(`${cliente} no tiene proyectos todavía. Creá uno con /capturar <url>.`);
    const kb = new InlineKeyboard();
    for (const p of projects.slice(0, MAX_BUTTONS)) kb.text(p, `pr:${short(p)}`).row();
    await ctx.reply(`Proyectos de ${cliente}:`, { reply_markup: kb });
  });

  bot.callbackQuery(/^pr:([0-9a-f]{8})$/, async (ctx) => {
    const { cliente } = store.getChatState(ctx.from.id);
    if (!cliente) return ctx.answerCallbackQuery({ text: "Elegí un cliente primero", show_alert: true });
    const name = (await listProjects(paths, cliente)).find((p) => short(p) === ctx.match[1]);
    if (!name) return ctx.answerCallbackQuery({ text: "Ya no existe ese proyecto", show_alert: true });
    store.setChatState(ctx.from.id, { proyecto: name });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Proyecto activo: ${cliente} / ${name}\nUsá /estado para ver el progreso.`);
  });

  bot.command("estado", async (ctx) => {
    const { cliente, proyecto } = store.getChatState(ctx.from!.id);
    if (!cliente || !proyecto) return ctx.reply("Elegí cliente y proyecto con /cliente y /proyecto");
    try {
      const m = await readManifest(paths, cliente, proyecto);
      const lines = AGENTES.map((a) => {
        const s = m.agentes[a];
        const cost = s.costo_usd ? ` · $${s.costo_usd.toFixed(3)}` : "";
        const msg = s.estado === "error" && s.mensaje ? ` — ${escapeHtml(s.mensaje)}` : "";
        return `${ICON[s.estado] ?? "⚪"} ${LABEL[a]}${cost}${msg}`;
      });
      const running = store.list(["queued", "running"], 5).filter((j) => j.proyecto === proyecto);
      const jobs = running.length ? `\n\nEn curso: ${running.map((j) => `${j.tipo} (#${j.id}, ${j.estado})`).join(", ")}` : "";
      await reply(
        ctx,
        `<b>${escapeHtml(cliente)} / ${escapeHtml(proyecto)}</b>\n${lines.join("\n")}\n\nCosto total: $${m.costo_total_usd.toFixed(3)} (tope $${config.MAX_USD_PER_PROJECT})${jobs}`,
        { parse_mode: "HTML" },
      );
    } catch {
      await ctx.reply("No encontré el manifest de ese proyecto.");
    }
  });

  bot.command("cancelar", async (ctx) => {
    const n = worker.cancelAllFor(ctx.from!.id);
    await ctx.reply(n ? `Cancelé ${n} trabajo(s).` : "No hay trabajos en curso.");
  });

  for (const [cmd, fase] of Object.entries(PENDIENTES)) {
    bot.command(cmd, (ctx) => ctx.reply(`/${cmd} todavía no está implementado (${fase} del instructivo).`));
  }

  bot.catch((err) => {
    console.error("Error en el bot:", err.error instanceof Error ? err.error.message : err.error);
  });

  return bot;
}
