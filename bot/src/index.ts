import pino from "pino";
import { webhookCallback } from "grammy";
import { loadConfig } from "./config.js";
import { createPaths } from "./paths.js";
import { JobStore, Worker } from "./queue/queue.js";
import { createHttpServer } from "./http.js";
import { createBot } from "./telegram/bot.js";
import { createLlm } from "./llm/index.js";
import { BrowserFetcher } from "./lib/browser.js";
import { MockTranscriber, WhisperCppTranscriber } from "./lib/whisper.js";
import { MockRenderer, RemotionCliRenderer } from "./agents/6-video.js";
import { NoPublisher, ZernioPublisher } from "./agents/9-publicar.js";
import { registerAgents } from "./agents/registry.js";
import { TelegramSender } from "./telegram/send.js";
import fs from "node:fs/promises";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["*.token", "*.apiKey", "*.authorization"],
});

async function main() {
  const config = loadConfig();
  const paths = createPaths(config.DATA_DIR);
  const store = new JobStore(paths.dbFile);

  // El worker avisa por Telegram; el bot necesita el worker (/cancelar). Se resuelve con una referencia tardía.
  const ref: { bot?: ReturnType<typeof createBot> } = {};
  const notify = (chatId: number | null, text: string) =>
    chatId && ref.bot ? ref.bot.api.sendMessage(chatId, text).catch(() => undefined) : Promise.resolve();

  const worker = new Worker(store, {
    onStart: (j) => void log.info({ job: j.id, tipo: j.tipo }, "job start"),
    onDone: (j) => void log.info({ job: j.id, tipo: j.tipo }, "job done"),
    onError: async (j, e) => {
      log.error({ job: j.id, tipo: j.tipo, error: e }, "job error");
      await notify(j.chat_id, `❌ ${j.tipo} falló: ${e}`);
    },
  });
  const realBot = createBot({ config, paths, store, worker });
  ref.bot = realBot;
  await fs.mkdir(paths.clientesDir, { recursive: true });
  await fs.mkdir(paths.estilosDir, { recursive: true });
  registerAgents(
    worker,
    {
      config,
      paths,
      store,
      llm: createLlm(config),
      fetcher: new BrowserFetcher(),
      transcriber: config.MOCK ? new MockTranscriber() : new WhisperCppTranscriber(),
      renderer: config.MOCK ? new MockRenderer() : new RemotionCliRenderer(),
      publisher: config.ZERNIO_API_KEY ? new ZernioPublisher(config.ZERNIO_API_KEY) : new NoPublisher(),
    },
    store,
    paths,
    new TelegramSender(realBot.api, !!config.TELEGRAM_API_ROOT),
  );
  await realBot.init(); // falla al arrancar (claro y temprano) si el token es inválido
  const recovered = store.recoverOnStart();
  worker.start();

  const handler = webhookCallback(realBot, "http", { secretToken: config.TELEGRAM_WEBHOOK_SECRET || undefined });
  const prod = config.NODE_ENV === "production";
  const server = createHttpServer({
    hookPath: prod ? `/telegram/${config.TELEGRAM_WEBHOOK_PATH}` : undefined,
    secretToken: config.TELEGRAM_WEBHOOK_SECRET || undefined,
    webhook: prod ? (req, res) => handler(req, res) : undefined,
    onError: (e) => log.error({ error: e instanceof Error ? e.message : String(e) }, "webhook"),
  });
  server.listen(config.PORT, () => log.info({ port: config.PORT }, "HTTP listo"));

  if (config.NODE_ENV === "development") {
    await realBot.api.deleteWebhook();
    void realBot.start({ onStart: (me) => log.info({ bot: me.username }, "Bot listo (polling)") });
  } else {
    log.info("Bot listo (webhook). Registrá el webhook con `npm run set-webhook`.");
  }

  for (const j of recovered) {
    await notify(j.chat_id, `⚠️ Se reinició el servidor y se interrumpió ${j.tipo} (#${j.id}). Volvé a lanzarlo.`);
  }

  const shutdown = () => {
    worker.stop();
    server.close();
    void realBot.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e instanceof Error ? e.message : e));

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
