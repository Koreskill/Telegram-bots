/**
 * Registra el webhook de Telegram. Si TELEGRAM_API_ROOT apunta al servidor local, se registra ahí
 * (acordate de hacer antes `logOut` en la API en la nube: ver docs/INSTRUCTIVO.md, Fase 8).
 */
import { loadConfig } from "../src/config.js";

const c = loadConfig();
if (!c.PUBLIC_URL) throw new Error("Falta PUBLIC_URL (ej. https://bot.tuagencia.com)");
const root = c.TELEGRAM_API_ROOT || "https://api.telegram.org";
const res = await fetch(`${root}/bot${c.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${c.PUBLIC_URL.replace(/\/$/, "")}/telegram/${c.TELEGRAM_WEBHOOK_PATH}`,
    secret_token: c.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});
console.log(res.status, await res.text());
