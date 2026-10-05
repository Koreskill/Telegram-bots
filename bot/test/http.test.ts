import { afterEach, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../src/http.js";

let server: http.Server;
afterEach(() => new Promise((r) => server.close(r)));

async function start(webhook: Parameters<typeof createHttpServer>[0]["webhook"]) {
  server = createHttpServer({ hookPath: "/telegram/abc", secretToken: "s3cret", webhook });
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (url: string, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers, body: "{}" });

describe("http", () => {
  it("/healthz responde 200", async () => {
    const base = await start(async (_q, res) => void res.end("ok"));
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
  it("webhook sin secret_token o con uno incorrecto → 401 y NO llega al handler", async () => {
    let called = 0;
    const base = await start(async (_q, res) => { called++; res.end("ok"); });
    expect((await post(`${base}/telegram/abc`)).status).toBe(401);
    expect((await post(`${base}/telegram/abc`, { "x-telegram-bot-api-secret-token": "mal" })).status).toBe(401);
    expect(called).toBe(0);
  });
  it("secret correcto → handler; ruta incorrecta → 404", async () => {
    const base = await start(async (_q, res) => void res.end("ok"));
    const h = { "x-telegram-bot-api-secret-token": "s3cret" };
    expect((await post(`${base}/telegram/abc`, h)).status).toBe(200);
    expect((await post(`${base}/telegram/otra`, h)).status).toBe(404);
  });
  it("un handler que revienta devuelve 500 y no tira el servidor", async () => {
    const base = await start(async () => { throw new Error("x"); });
    expect((await post(`${base}/telegram/abc`, { "x-telegram-bot-api-secret-token": "s3cret" })).status).toBe(500);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
