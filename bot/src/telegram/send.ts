import fs from "node:fs/promises";
import { InlineKeyboard, InputFile, type Api } from "grammy";
import type { AgentResult, Boton } from "../agents/context.js";
import { splitText } from "./text.js";
import { createProgress, type Progress } from "./progress.js";

/** Abstracción del canal de salida (el bot real usa Telegram; los tests usan un doble). */
export interface Sender {
  progress(chatId: number, initial: string): Promise<Progress>;
  result(chatId: number, r: AgentResult): Promise<void>;
  text(chatId: number, text: string, botones?: Boton[][]): Promise<void>;
}

export const toKeyboard = (b: Boton[][]): InlineKeyboard => {
  const kb = new InlineKeyboard();
  for (const row of b) {
    for (const x of row) {
      if (Buffer.byteLength(x.data) > 64) throw new Error(`callback_data demasiado largo: ${x.data}`);
      kb.text(x.texto, x.data);
    }
    kb.row();
  }
  return kb;
};

export class TelegramSender implements Sender {
  /** Tope de subida: 50 MB en la API pública, 2 GB con servidor local. */
  private maxBytes: number;
  constructor(private api: Api, local: boolean) {
    this.maxBytes = local ? 2000 * 1024 * 1024 : 50 * 1024 * 1024;
  }

  progress(chatId: number, initial: string) {
    return createProgress(this.api, chatId, initial);
  }

  async text(chatId: number, text: string, botones?: Boton[][]) {
    const parts = splitText(text);
    for (const [i, p] of parts.entries()) {
      const last = i === parts.length - 1;
      await this.api.sendMessage(chatId, p, last && botones?.length ? { reply_markup: toKeyboard(botones) } : {});
    }
  }

  async result(chatId: number, r: AgentResult) {
    const media = r.media ?? [];
    const hasButtons = media.some((m) => m.botones?.length);
    // Álbum solo si son fotos sin botones individuales.
    if (media.length > 1 && !hasButtons && media.every((m) => (m.tipo ?? "foto") === "foto")) {
      await this.text(chatId, r.texto);
      for (let i = 0; i < media.length; i += 10) {
        await this.api.sendMediaGroup(chatId, media.slice(i, i + 10).map((m) => ({ type: "photo" as const, media: new InputFile(m.path), caption: m.caption })));
      }
      if (r.botones?.length) await this.api.sendMessage(chatId, "¿Cómo seguimos?", { reply_markup: toKeyboard(r.botones) });
      return;
    }
    await this.text(chatId, r.texto, media.length ? undefined : r.botones);
    for (const m of media) {
      const opts = { caption: m.caption, ...(m.botones?.length ? { reply_markup: toKeyboard(m.botones) } : {}) };
      const size = (await fs.stat(m.path)).size;
      if (size > this.maxBytes) {
        await this.api.sendMessage(chatId, `📦 ${m.path} pesa ${(size / 1024 / 1024).toFixed(0)} MB y supera el límite de Telegram. Está guardado en el servidor.`);
        continue;
      }
      const file = new InputFile(m.path);
      switch (m.tipo ?? "foto") {
        case "foto":
          // sendPhoto limita a 10 MB: las grandes salen como documento sin perder calidad.
          if (size > 10 * 1024 * 1024) await this.api.sendDocument(chatId, file, opts);
          else await this.api.sendPhoto(chatId, file, opts);
          break;
        case "video":
          await this.api.sendVideo(chatId, file, { ...opts, supports_streaming: true });
          break;
        case "audio":
          await this.api.sendAudio(chatId, file, opts);
          break;
        default:
          await this.api.sendDocument(chatId, file, opts);
      }
    }
    if (media.length && r.botones?.length) await this.api.sendMessage(chatId, "¿Cómo seguimos?", { reply_markup: toKeyboard(r.botones) });
  }
}
