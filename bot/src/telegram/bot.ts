import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Config } from "../config.js";
import { UnsafePathError, type Paths } from "../paths.js";
import { AGENTES, listClients, listProjects, readManifest, updateManifest, type AgenteId } from "../project/manifest.js";
import { createCliente } from "../project/cliente.js";
import { destinoVideoSubido, editarPrompt, editarSubtitulos, esNombreImagen, leerPrompt } from "../project/acciones.js";
import type { JobStore, Worker } from "../queue/queue.js";
import { CLASE, enqueueAgent, esAgente, type AgentJob } from "../agents/registry.js";
import { aprobarImagen, aprobarTodas } from "../agents/4-extender.js";
import { copyFile } from "../agents/9-publicar.js";
import { probe } from "../lib/ffmpeg.js";
import { readJson } from "../lib/hash.js";
import { listSkills } from "../skills.js";
import { escapeHtml, splitText } from "./text.js";
import { esUrl, parseArgs, parseFechaAR } from "./args.js";

export interface BotDeps {
  config: Config;
  paths: Paths;
  store: JobStore;
  worker: Worker;
}

const short = (name: string) => createHash("sha1").update(name).digest("hex").slice(0, 8);
const MAX_BUTTONS = 40;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;

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

/** Comando → agente que dispara (los que necesitan proyecto activo). */
const COMANDOS_PROYECTO: Record<string, AgentJob> = {
  imagenes: "imagenes",
  prompts: "prompts",
  extender: "extender",
  guion: "guion",
  voz: "voz",
  video: "video",
  publicar: "publicar",
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
  const chatId = (ctx: Context) => ctx.from!.id;
  const activo = (ctx: Context) => store.getChatState(chatId(ctx));

  /** Valida que haya cliente+proyecto activos y que el proyecto exista. */
  const requerirProyecto = async (ctx: Context): Promise<{ cliente: string; proyecto: string } | null> => {
    const { cliente, proyecto } = activo(ctx);
    if (!cliente || !proyecto) {
      await ctx.reply("Elegí cliente y proyecto con /cliente y /proyecto (o creá uno con /capturar <url>).");
      return null;
    }
    try {
      await readManifest(paths, cliente, proyecto);
    } catch {
      await ctx.reply(`No encuentro el proyecto ${cliente} / ${proyecto}. Elegí otro con /proyecto.`);
      return null;
    }
    return { cliente, proyecto };
  };

  const lanzar = async (ctx: Context, tipo: AgentJob, args: Record<string, unknown> = {}, o: { cliente?: string; proyecto?: string } = {}) => {
    const p = o.cliente && o.proyecto ? { cliente: o.cliente, proyecto: o.proyecto } : await requerirProyecto(ctx);
    if (!p) return;
    const job = enqueueAgent(store, { tipo, chatId: chatId(ctx), cliente: p.cliente, proyecto: p.proyecto, args });
    const limite = CLASE[tipo] === "heavy" ? 1 : 3;
    if (store.countRunning(CLASE[tipo]) >= limite) await ctx.reply(`🕐 ${tipo} en cola (#${job.id}); empieza cuando termine el trabajo en curso.`);
  };

  const iniciarCaptura = async (ctx: Context, url: string, clienteArg: string | undefined, auto: boolean) => {
    const clients = await listClients(paths);
    let cliente = activo(ctx).cliente;
    if (clienteArg) {
      const c = clients.find((x) => x.toLowerCase() === clienteArg.toLowerCase());
      if (!c) return void (await ctx.reply(`No existe el cliente "${clienteArg}". Clientes: ${clients.join(", ") || "(ninguno; creá uno con /nuevocliente)"}`));
      cliente = c;
    }
    if (!cliente) return void (await ctx.reply("Primero elegí el cliente con /cliente (o creá uno con /nuevocliente <nombre>)."));
    const job = enqueueAgent(store, { tipo: "capturar", chatId: chatId(ctx), cliente, proyecto: null, args: { url, auto } });
    void job;
  };

  // ───────────── comandos generales
  bot.command("start", (ctx) => reply(ctx, ayudaBreve(), { parse_mode: "HTML" }));
  bot.command("ayuda", async (ctx) => {
    const lineas = listSkills().map((s) => `<b>${escapeHtml(s.meta["agente"] ?? "")}. ${escapeHtml(s.id)}</b> — ${escapeHtml(s.meta["descripcion"] ?? "")}\n   ${escapeHtml(s.meta["trigger"] ?? "")}`);
    await reply(ctx, `${ayudaBreve()}\n\n<b>Agentes</b>\n${lineas.join("\n")}`, { parse_mode: "HTML" });
  });

  bot.command("nuevocliente", async (ctx) => {
    const nombre = ctx.match.trim();
    if (!nombre) return void (await ctx.reply("Uso: /nuevocliente <nombre del cliente>"));
    try {
      const r = await createCliente(paths, nombre);
      if (!r.creado) return void (await ctx.reply(`El cliente "${r.id}" ya existe.`));
      store.setChatState(chatId(ctx), { cliente: r.id, proyecto: null });
      await ctx.reply(`✅ Cliente "${r.id}" creado y activo.\nCompletá clientes/${r.id}/cliente.json (marca, colores, logo, contacto, cuentas de Zernio) y mandá una URL con /capturar.`);
    } catch (e) {
      await ctx.reply(e instanceof UnsafePathError ? "Nombre no permitido (sin barras, puntos iniciales ni '..')." : `Error: ${e instanceof Error ? e.message : e}`);
    }
  });

  bot.command("cliente", async (ctx) => {
    const clients = await listClients(paths);
    if (clients.length === 0) return ctx.reply(`No encontré clientes en ${paths.clientesDir}. Creá uno con /nuevocliente <nombre>.`);
    const kb = new InlineKeyboard();
    for (const c of clients.slice(0, MAX_BUTTONS)) kb.text(c, `cl:${short(c)}`).row();
    const extra = clients.length > MAX_BUTTONS ? `\n(mostrando ${MAX_BUTTONS} de ${clients.length})` : "";
    await ctx.reply(`Elegí el cliente:${extra}`, { reply_markup: kb });
  });

  bot.callbackQuery(/^cl:([0-9a-f]{8})$/, async (ctx) => {
    const name = (await listClients(paths)).find((c) => short(c) === ctx.match[1]);
    if (!name) return ctx.answerCallbackQuery({ text: "Ya no existe ese cliente", show_alert: true });
    store.setChatState(ctx.from.id, { cliente: name, proyecto: null });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Cliente activo: ${name}\nUsá /proyecto para elegir un proyecto o mandá una URL para crear uno.`);
  });

  bot.command("proyecto", async (ctx) => {
    const { cliente } = activo(ctx);
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
    const { cliente, proyecto } = activo(ctx);
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
        `<b>${escapeHtml(cliente)} / ${escapeHtml(proyecto)}</b>\n${lines.join("\n")}\n\nCosto total: $${m.costo_total_usd.toFixed(3)} (tope $${config.MAX_USD_PER_PROJECT} · hoy $${store.spentToday().toFixed(2)}/${config.MAX_USD_PER_DAY})${jobs}`,
        { parse_mode: "HTML" },
      );
    } catch {
      await ctx.reply("No encontré el manifest de ese proyecto.");
    }
  });

  bot.command("cancelar", async (ctx) => {
    store.clearPending(chatId(ctx));
    const n = worker.cancelAllFor(chatId(ctx));
    await ctx.reply(n ? `Cancelé ${n} trabajo(s).` : "No hay trabajos en curso.");
  });

  // ───────────── triggers de agentes
  bot.command("capturar", async (ctx) => {
    const { pos } = parseArgs(ctx.match);
    if (!pos[0] || !esUrl(pos[0])) return void (await ctx.reply("Uso: /capturar <url> [cliente]  (o pegá la URL directamente en el chat)"));
    await iniciarCaptura(ctx, pos[0], pos.slice(1).join(" ") || undefined, false);
  });

  bot.command("todo", async (ctx) => {
    const { pos } = parseArgs(ctx.match);
    if (!pos[0] || !esUrl(pos[0])) return void (await ctx.reply("Uso: /todo <url> [cliente] — captura, descarga y prepara prompts; se detiene para que apruebes."));
    await iniciarCaptura(ctx, pos[0], pos.slice(1).join(" ") || undefined, true);
  });

  for (const [cmd, tipo] of Object.entries(COMANDOS_PROYECTO)) {
    bot.command(cmd, async (ctx) => {
      const { pos, flags } = parseArgs(ctx.match);
      const args: Record<string, unknown> = { ...flags };
      if (tipo === "video" && pos[0]) args["estilo"] = pos[0];
      if (tipo === "extender" && pos.length) args["solo"] = pos.map((p) => (p.startsWith("img_") ? p : `img_${p.padStart(3, "0")}`));
      await lanzar(ctx, tipo, args);
    });
  }

  bot.command("estilos", async (ctx) => {
    const { flags } = parseArgs(ctx.match);
    const { cliente, proyecto } = activo(ctx);
    // /estilos no necesita proyecto; usa uno ficticio solo para el contexto.
    enqueueAgent(store, { tipo: "estilos", chatId: chatId(ctx), cliente: cliente ?? "", proyecto: proyecto ?? "", args: { ...flags } });
  });

  bot.command("subir", (ctx) =>
    ctx.reply("Mandame el video grabado como ARCHIVO/documento (así Telegram no lo comprime) y lo guardo en el proyecto activo. Después ejecutá /guion."),
  );

  // ───────────── subida del video grabado
  bot.on(["message:video", "message:document"], async (ctx) => {
    const doc = ctx.message.document;
    const vid = ctx.message.video;
    const fileId = vid?.file_id ?? doc?.file_id;
    const nombre = vid?.file_name ?? doc?.file_name ?? "video.mp4";
    const esVideo = !!vid || (doc?.mime_type?.startsWith("video/") ?? false) || VIDEO_EXT.test(nombre);
    if (!fileId || !esVideo) return void (await ctx.reply("Ese archivo no parece un video. Para el video grabado mandá un .mp4/.mov."));
    const p = await requerirProyecto(ctx);
    if (!p) return;
    const ext = path.extname(nombre).slice(1) || (doc?.mime_type?.split("/")[1] ?? "mp4");
    const dest = await destinoVideoSubido(paths, p.cliente, p.proyecto, ext);
    await ctx.reply("⬇️ Recibiendo el video…");
    try {
      await descargarArchivo(bot, config, fileId, dest);
      const info = await probe(dest);
      await updateManifest(paths, p.cliente, p.proyecto, (m) => {
        m.agentes.guion = { ...m.agentes.guion, estado: "pending", hash_entrada: undefined };
      });
      await ctx.reply(`✅ Video guardado: ${info.ancho}×${info.alto}, ${info.duracion_s.toFixed(0)} s${info.tieneAudio ? "" : " (sin audio)"}.`, {
        reply_markup: new InlineKeyboard().text("➡️ Preparar guion (/guion)", "next:guion").row().text("🎙 Guion con voz en off", "next:guion_voz"),
      });
    } catch (e) {
      await fs.promises.rm(dest, { force: true });
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(/too big/i.test(msg) ? "⚠️ Telegram no deja bajar archivos de más de 20 MB con la API pública. Hace falta el servidor Bot API local (ver docs/INSTRUCTIVO.md, Fase 8) o dejar el archivo en 02_media/video_grabado/original.mp4." : `❌ No pude guardar el video: ${msg}`);
    }
  });

  // ───────────── botones
  bot.callbackQuery(/^next:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const clave = ctx.match[1]!;
    const args: Record<string, unknown> = clave === "guion_voz" ? { voz: true } : {};
    const tipo = clave === "guion_voz" ? "guion" : clave;
    if (!esAgente(tipo) || tipo === "publicar_ejecutar" || tipo === "capturar" || tipo === "estilos") return;
    await lanzar(ctx, tipo, args);
  });

  bot.callbackQuery(/^(rg|bl|ok):(img_\d{3,})$/, async (ctx) => {
    const [, accion, img] = ctx.match as unknown as [string, string, string];
    const p = activo(ctx);
    if (!p.cliente || !p.proyecto) return ctx.answerCallbackQuery({ text: "Elegí un proyecto", show_alert: true });
    if (accion === "ok") {
      await aprobarImagen({ paths, cliente: p.cliente, slug: p.proyecto }, img);
      await ctx.answerCallbackQuery({ text: `${img} aprobada ✅` });
      return;
    }
    await ctx.answerCallbackQuery({ text: accion === "rg" ? "Regenerando…" : "Aplicando blur…" });
    await lanzar(ctx, "extender", { solo: [img], ...(accion === "bl" ? { blur: true } : {}) });
  });

  bot.callbackQuery("okall:x", async (ctx) => {
    const p = activo(ctx);
    if (!p.cliente || !p.proyecto) return ctx.answerCallbackQuery({ text: "Elegí un proyecto", show_alert: true });
    const n = await aprobarTodas({ paths, cliente: p.cliente, slug: p.proyecto });
    await ctx.answerCallbackQuery({ text: `${n} imágenes aprobadas ✅` });
    await ctx.reply(`✅ ${n} imágenes aprobadas. Siguiente: subí el video grabado con /subir y luego /guion.`, {
      reply_markup: new InlineKeyboard().text("➡️ Ya subí el video: /guion", "next:guion"),
    });
  });

  bot.callbackQuery(/^ep:(img_\d{3,})$/, async (ctx) => {
    const p = activo(ctx);
    if (!p.cliente || !p.proyecto) return ctx.answerCallbackQuery({ text: "Elegí un proyecto", show_alert: true });
    const img = ctx.match[1]!;
    const actual = await leerPrompt(paths, p.cliente, p.proyecto, img);
    store.setPending(chatId(ctx), "editar_prompt", { img });
    await ctx.answerCallbackQuery();
    await reply(ctx, `Prompt actual de ${img}:\n\n${actual ?? "(no encontrado)"}\n\nRespondé con el prompt nuevo (en inglés). /cancelar para dejarlo como está.`);
  });

  bot.callbackQuery("pl:cambios", async (ctx) => {
    await ctx.answerCallbackQuery();
    store.setPending(chatId(ctx), "cambios_plan");
    await ctx.reply("¿Qué querés cambiar del plan? Escribilo en una frase (ej. \"sacá el chip de la laguna y agregá la foto de la cocina a los 8 s\"). /cancelar para salir.");
  });

  bot.callbackQuery("st:edit", async (ctx) => {
    await ctx.answerCallbackQuery();
    const p = activo(ctx);
    if (!p.cliente || !p.proyecto) return;
    store.setPending(chatId(ctx), "editar_subtitulos");
    const t = await readJson<{ palabras: { texto: string }[] }>(path.join(paths.subdir(p.cliente, p.proyecto, "guion"), "transcripcion.json")).catch(() => null);
    await reply(ctx, `Subtítulos actuales (${t?.palabras.length ?? 0} palabras):\n\n${t?.palabras.map((w) => w.texto).join(" ") ?? "(sin transcripción)"}\n\nRespondé con el texto corregido. Tiene que tener la MISMA cantidad de palabras (para no perder la sincronización).`);
  });

  bot.callbackQuery("vf:final", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Renderizando el final…" });
    await lanzar(ctx, "video", { final: true });
  });

  bot.callbackQuery(/^vr:([\w-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Regenerando voz…" });
    await lanzar(ctx, "voz", { solo: ctx.match[1] });
  });

  // Publicación: nada sale sin una confirmación explícita.
  bot.callbackQuery(/^pub:(\w+)$/, async (ctx) => {
    const accion = ctx.match[1]!;
    await ctx.answerCallbackQuery();
    switch (accion) {
      case "ahora":
        return void (await ctx.reply("⚠️ ¿Confirmás publicar AHORA en las redes del cliente? Esto es público.", {
          reply_markup: new InlineKeyboard().text("✅ Sí, publicar ahora", "pub:ahora_ok").text("✖️ No", "pub:cancel"),
        }));
      case "ahora_ok":
        return void (await lanzar(ctx, "publicar_ejecutar", { modo: "ahora" }));
      case "borrador":
        return void (await lanzar(ctx, "publicar_ejecutar", { modo: "borrador" }));
      case "prog":
        store.setPending(chatId(ctx), "publicar_programar");
        return void (await ctx.reply("¿Cuándo? Escribí fecha y hora (Argentina) así: 2026-10-12 18:30"));
      case "edit":
        store.setPending(chatId(ctx), "publicar_editar");
        return void (await ctx.reply("Mandame el texto nuevo para la publicación."));
      default:
        store.clearPending(chatId(ctx));
        return void (await ctx.reply("Publicación cancelada. No se publicó nada."));
    }
  });

  // ───────────── texto libre: respuestas pendientes o URL pegada
  bot.on("message:text", async (ctx) => {
    const texto = ctx.message.text.trim();
    const pend = store.getPending(chatId(ctx));
    if (pend) {
      const p = await requerirProyecto(ctx);
      store.clearPending(chatId(ctx));
      if (!p) return;
      try {
        switch (pend.tipo) {
          case "editar_prompt":
            await editarPrompt(paths, p.cliente, p.proyecto, String(pend.data["img"]), texto);
            return void (await ctx.reply(`✅ Prompt de ${pend.data["img"]} actualizado. Corré /extender cuando estés listo.`));
          case "cambios_plan":
            await ctx.reply("🧠 Aplicando los cambios al plan…");
            return void (await lanzar(ctx, "guion", { cambios: texto }));
          case "editar_subtitulos": {
            const r = await editarSubtitulos(paths, p.cliente, p.proyecto, texto);
            return void (await ctx.reply(r.ok ? "✅ Subtítulos actualizados." : `❌ Tu texto tiene ${r.recibidas} palabras y la transcripción ${r.esperadas}. Tocá "Corregir subtítulos" de nuevo y mantené la misma cantidad.`));
          }
          case "publicar_editar":
            await fs.promises.writeFile(copyFile({ paths, cliente: p.cliente, slug: p.proyecto }), texto);
            return void (await lanzar(ctx, "publicar", { caption: texto }));
          case "publicar_programar": {
            const iso = parseFechaAR(texto);
            if (!iso) return void (await ctx.reply("No entendí la fecha (o ya pasó). Formato: 2026-10-12 18:30"));
            return void (await lanzar(ctx, "publicar_ejecutar", { modo: "programar", fecha: iso }));
          }
        }
      } catch (e) {
        return void (await ctx.reply(`❌ ${e instanceof Error ? e.message : e}`));
      }
      return;
    }
    if (esUrl(texto)) return void (await iniciarCaptura(ctx, texto, undefined, false));
  });

  bot.catch(async (err) => {
    console.error("Error en el bot:", err.error instanceof Error ? err.error.message : err.error);
    await err.ctx.reply(`⚠️ Algo falló: ${err.error instanceof Error ? err.error.message.slice(0, 200) : "error desconocido"}`).catch(() => undefined);
  });

  return bot;
}

function ayudaBreve(): string {
  return [
    "<b>Bot inmobiliario</b>",
    "",
    "<b>Ruta:</b> /capturar &lt;url&gt; → /imagenes → /prompts → /extender → /subir + /guion → /voz → /video → /publicar",
    "Atajos: pegá una URL en el chat, o /todo &lt;url&gt; para encadenar hasta la aprobación de prompts.",
    "",
    "<b>Gestión:</b> /nuevocliente /cliente /proyecto /estado /cancelar /estilos /ayuda",
    "Flags: /extender 3 5 (solo esas) · /guion --voz · /video premium · /video --final · --forzar",
  ].join("\n");
}

/** Descarga un archivo de Telegram: copia local (servidor Bot API en modo --local) o HTTP. */
async function descargarArchivo(bot: Bot, config: Config, fileId: string, dest: string): Promise<void> {
  const f = await bot.api.getFile(fileId);
  const p = f.file_path;
  if (!p) throw new Error("Telegram no devolvió la ruta del archivo");
  if (path.isAbsolute(p)) {
    await fs.promises.copyFile(p, dest);
    return;
  }
  const root = config.TELEGRAM_API_ROOT || "https://api.telegram.org";
  const res = await fetch(`${root}/file/bot${config.TELEGRAM_BOT_TOKEN}/${p}`);
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
}

