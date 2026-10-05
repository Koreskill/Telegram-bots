import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { loadConfig } from "../src/config.js";
import { createPaths, type Paths } from "../src/paths.js";
import { JobStore } from "../src/queue/queue.js";
import { MockLlm } from "../src/llm/mock.js";
import { HttpFetcher } from "../src/lib/browser.js";
import { MockTranscriber } from "../src/lib/whisper.js";
import { MockRenderer } from "../src/agents/6-video.js";
import { makeContext, type AgentContext, type AgentDeps } from "../src/agents/context.js";
import type { Publisher, PublishRequest } from "../src/agents/9-publicar.js";
import { run } from "../src/lib/ffmpeg.js";
import { __permitirRedPrivadaSoloTests } from "../src/lib/net.js";
import { createCliente } from "../src/project/cliente.js";

export class FakePublisher implements Publisher {
  llamadas: PublishRequest[] = [];
  async publicar(r: PublishRequest) {
    this.llamadas.push(r);
    return { postId: "post123", estado: r.modo === "ahora" ? "published" : "draft", urls: r.modo === "ahora" ? ["https://instagram.com/reel/x"] : [] };
  }
}

export interface Env {
  dir: string;
  paths: Paths;
  store: JobStore;
  llm: MockLlm;
  publisher: FakePublisher;
  deps: AgentDeps;
  ctx(cliente: string, slug: string, args?: Record<string, unknown>): AgentContext;
  cleanup(): Promise<void>;
}

export async function makeEnv(envOverrides: Record<string, string> = {}): Promise<Env> {
  __permitirRedPrivadaSoloTests(true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-e2e-"));
  const paths = createPaths(dir);
  const store = new JobStore(":memory:");
  const llm = new MockLlm();
  const publisher = new FakePublisher();
  const config = loadConfig({ NODE_ENV: "test", TELEGRAM_BOT_TOKEN: "123456:ABCDEF", TELEGRAM_ALLOWED_IDS: "1", MOCK: "1", DATA_DIR: dir, ...envOverrides });
  const deps: AgentDeps = { config, paths, llm, store, fetcher: new HttpFetcher(), transcriber: new MockTranscriber(), renderer: new MockRenderer(), publisher };
  return {
    dir, paths, store, llm, publisher, deps,
    ctx: (cliente, slug, args) => makeContext(deps, { cliente, slug, signal: new AbortController().signal, args }),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

export async function crearCliente(env: Env, nombre = "Inmo Demo"): Promise<string> {
  await createCliente(env.paths, nombre);
  return nombre;
}

/** Imagen sintética distinguible (formas según `seed`) de w×h en JPEG. */
export async function imagenSintetica(seed: number, w = 1600, h = 1200): Promise<Buffer> {
  const rects = Array.from({ length: 14 }, (_, i) => {
    const x = ((seed * 97 + i * 131) % 80) / 100;
    const y = ((seed * 53 + i * 71) % 80) / 100;
    const c = ((seed * 31 + i * 67) * 2654435761) % 0xffffff;
    return `<rect x="${x * w}" y="${y * h}" width="${w * 0.25}" height="${h * 0.2}" fill="#${c.toString(16).padStart(6, "0")}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${((seed * 7919) % 0xffffff).toString(16).padStart(6, "0")}"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

export interface Fixture {
  base: string;
  close(): Promise<void>;
  hits: string[];
}

/** Servidor local con una ficha de propiedad y sus imágenes (incluye duplicado, logo y miniatura). */
export async function fixtureServer(): Promise<Fixture> {
  const a = await imagenSintetica(1);
  const aDup = await sharp(a).resize(1000, 750).jpeg({ quality: 70 }).toBuffer();
  const b = await imagenSintetica(2);
  const v = await imagenSintetica(3, 1080, 1920);
  const logo = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#cc0000" } }).png().toBuffer();
  const mini = await imagenSintetica(4, 300, 200);
  const hits: string[] = [];
  const files: Record<string, [Buffer, string]> = {
    "/img/a.jpg": [a, "image/jpeg"], "/img/a-dup.jpg": [aDup, "image/jpeg"], "/img/b.jpg": [b, "image/jpeg"],
    "/img/v.jpg": [v, "image/jpeg"], "/img/logo.png": [logo, "image/png"], "/img/mini.jpg": [mini, "image/jpeg"],
  };
  const html = (base: string) => `<!doctype html><html><head><title>Casa en Finca Dos - Inmobiliaria</title>
<meta property="og:image" content="${base}/img/a.jpg"><meta name="description" content="Casa moderna en barrio privado">
<script type="application/ld+json">{"@type":"House","name":"Casa en Finca Dos"}</script></head>
<body><nav>Menú</nav><img src="/img/logo.png" alt="logo"><h1>Casa en Finca Dos</h1>
<p>Venta USD 250.000. 5 ambientes, 3 dormitorios, 2 baños. Lote 800 m². Laguna, canchas de pádel y pileta.</p>
<img data-src="/img/a-dup.jpg" srcset="/img/a-dup.jpg 1000w, /img/a.jpg 1600w" alt="Frente">
<img src="/img/b.jpg" alt="Living"><img src="/img/v.jpg" alt="Detalle"><img src="/img/mini.jpg" alt="miniatura">
<img src="/img/noexiste.jpg" alt="roto"><iframe src="https://www.youtube.com/embed/abc123"></iframe>
<footer>Contacto</footer></body></html>`;
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === "/propiedad.html") return void res.writeHead(200, { "content-type": "text/html" }).end(html(base));
    if (req.url === "/redir") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
    const f = files[req.url ?? ""];
    if (f) return void res.writeHead(200, { "content-type": f[1] }).end(f[0]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, hits, close: () => new Promise((r) => server.close(() => r())) };
}

export async function makeVideo(file: string, secs = 6, o: { audio?: boolean; size?: string } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const args = ["-y", "-f", "lavfi", "-i", `testsrc=duration=${secs}:size=${o.size ?? "640x360"}:rate=30`];
  if (o.audio !== false) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(o.audio !== false ? ["-c:a", "aac", "-shortest"] : []), file);
  await run("ffmpeg", args);
}
