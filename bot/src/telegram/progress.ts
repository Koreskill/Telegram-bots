import type { Api } from "grammy";

export interface Progress {
  update(text: string): void;
  finish(text: string): Promise<void>;
}

/**
 * Un solo mensaje que se va editando. Throttle: como mucho una edición cada `minMs`
 * (por defecto 2 s); si llegan varias actualizaciones, se envía la última.
 */
export async function createProgress(api: Api, chatId: number, initial: string, minMs = 2000): Promise<Progress> {
  const msg = await api.sendMessage(chatId, initial);
  let last = initial;
  let sent = initial;
  let lastAt = Date.now();
  let timer: NodeJS.Timeout | undefined;

  const flush = async () => {
    timer = undefined;
    if (last === sent) return;
    sent = last;
    lastAt = Date.now();
    try {
      await api.editMessageText(chatId, msg.message_id, sent);
    } catch {
      /* "message is not modified" o límite de tasa: se ignora */
    }
  };

  return {
    update(text) {
      last = text;
      const wait = minMs - (Date.now() - lastAt);
      if (wait <= 0 && !timer) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), Math.max(wait, 0));
    },
    async finish(text) {
      if (timer) clearTimeout(timer);
      last = text;
      await flush();
    },
  };
}
