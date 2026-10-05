import http from "node:http";
import { timingSafeEqual } from "node:crypto";

export interface HttpOptions {
  /** Ruta exacta del webhook (ej. /telegram/<secreto>); undefined = sin webhook (polling). */
  hookPath?: string;
  secretToken?: string;
  webhook?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<unknown>;
  onError?: (e: unknown) => void;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Servidor HTTP mínimo: /healthz y el webhook de Telegram (verifica el secret_token antes de nada). */
export function createHttpServer(o: HttpOptions): http.Server {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (o.webhook && o.hookPath && req.method === "POST" && req.url === o.hookPath) {
      if (o.secretToken) {
        const got = req.headers["x-telegram-bot-api-secret-token"];
        if (typeof got !== "string" || !same(got, o.secretToken)) {
          res.writeHead(401).end();
          return;
        }
      }
      o.webhook(req, res).catch((e) => {
        o.onError?.(e);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
}
