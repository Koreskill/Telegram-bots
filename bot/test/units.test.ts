import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { OpenRouterClient, extractJson } from "../src/llm/openrouter.js";
import { ZernioPublisher } from "../src/agents/9-publicar.js";
import { assertPublicUrl, isPrivateIp, safeFetch, UnsafeUrlError } from "../src/lib/net.js";
import { bestFromSrcset, clasificarVideo, reducirHtml } from "../src/lib/html.js";
import { repararPlan } from "../src/agents/plan.js";
import { editPlanSchema, type EditPlan } from "../src/schemas/plan.js";
import { listSkills, loadSkill, parseSkill, skillPrompt } from "../src/skills.js";
import { esUrl, parseArgs, parseFechaAR } from "../src/telegram/args.js";
import { agruparPalabras, aplicarCorrecciones, aSrt, paginas, srtTime } from "../src/lib/transcripcion.js";
import { hamming } from "../src/lib/imagen.js";
import { normalizarAnalisis } from "../src/agents/3-prompts.js";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const cfg = { OPENROUTER_API_KEY: "sk-test", OPENROUTER_REFERER: "https://x.com", OPENROUTER_TITLE: "t" };
const sleep0 = async () => undefined;

describe("OpenRouterClient", () => {
  const schema = z.object({ n: z.number(), s: z.string() });

  it("json(): arma response_format json_schema estricto y devuelve datos + costo", async () => {
    const f = vi.fn(async (_u: unknown, _i: RequestInit) => json({ choices: [{ message: { content: '{"n":1,"s":"a"}' } }], usage: { cost: 0.002 } }));
    const c = new OpenRouterClient(cfg, f as never, sleep0);
    const r = await c.json({ model: "m", system: "sys", user: "hola", name: "x", schema });
    expect(r).toEqual({ data: { n: 1, s: "a" }, costUsd: 0.002 });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(body.usage).toEqual({ include: true });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test");
  });

  it("json(): reintenta con el error de validación y suma los costos (máx. 2)", async () => {
    const respuestas = ['{"n":"mal"}', "no es json", '```json\n{"n":2,"s":"ok"}\n```'];
    const f = vi.fn(async (_u: unknown, _i: RequestInit) => json({ choices: [{ message: { content: respuestas.shift() } }], usage: { cost: 0.001 } }));
    const c = new OpenRouterClient(cfg, f as never, sleep0);
    const r = await c.json({ model: "m", system: "s", user: "u", name: "x", schema });
    expect(r.data).toEqual({ n: 2, s: "ok" });
    expect(r.costUsd).toBeCloseTo(0.003, 6);
    expect(f).toHaveBeenCalledTimes(3);
    const ult = JSON.parse(String(f.mock.calls[2]![1].body)).messages;
    expect(ult.at(-1).content).toMatch(/no es válida/);
  });

  it("json(): si agota los reintentos, falla con un mensaje claro", async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: "{}" } }] }));
    const c = new OpenRouterClient(cfg, f as never, sleep0);
    await expect(c.json({ model: "m", system: "s", user: "u", name: "x", schema })).rejects.toThrow(/no cumple el esquema "x"/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("reintenta 429/5xx respetando Retry-After y no reintenta 4xx", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 3 ? new Response("busy", { status: n === 1 ? 429 : 503, headers: { "retry-after": "1" } }) : json({ choices: [{ message: { content: '{"n":1,"s":"a"}' } }] })));
    const esperas: number[] = [];
    const c = new OpenRouterClient(cfg, f as never, async (ms) => void esperas.push(ms));
    await c.json({ model: "m", system: "s", user: "u", name: "x", schema });
    expect(f).toHaveBeenCalledTimes(3);
    expect(esperas[0]).toBe(1000);
    const g = vi.fn(async () => new Response("bad key", { status: 401 }));
    await expect(new OpenRouterClient(cfg, g as never, sleep0).json({ model: "m", system: "s", user: "u", name: "x", schema })).rejects.toThrow(/401/);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("image(): usa modalities + image_config y decodifica el data URL", async () => {
    const png = Buffer.from("PNGDATA");
    const f = vi.fn(async (_u: unknown, _i: RequestInit) => json({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] } }], usage: { cost: 0.04 } }));
    const c = new OpenRouterClient(cfg, f as never, sleep0);
    const r = await c.image({ model: "google/gemini-2.5-flash-image", prompt: "p", imageBase64: "AAAA", mime: "image/jpeg", aspectRatio: "9:16" });
    expect(r.png.toString()).toBe("PNGDATA");
    expect(r.costUsd).toBe(0.04);
    const body = JSON.parse(String(f.mock.calls[0]![1].body));
    expect(body.modalities).toEqual(["image", "text"]);
    expect(body.image_config).toEqual({ aspect_ratio: "9:16" });
    expect(body.messages[0].content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
  });

  it("image(): sin imagen en la respuesta → error claro", async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: "no puedo" } }] }));
    await expect(new OpenRouterClient(cfg, f as never, sleep0).image({ model: "m", prompt: "p", imageBase64: "A", mime: "image/jpeg", aspectRatio: "9:16" })).rejects.toThrow(/no devolvió una imagen/);
  });

  it("speech(): arma el audio desde el stream SSE (chunks partidos) y toma el costo", async () => {
    const pcm = Buffer.from(Array.from({ length: 4800 }, (_, i) => i % 251));
    const mitad = pcm.length / 2;
    const ev = (b: Buffer) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: b.toString("base64") } } }] })}\n\n`;
    const sse = ev(pcm.subarray(0, mitad)) + ev(pcm.subarray(mitad)) + `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01 } })}\n\ndata: [DONE]\n\n`;
    // se parte en trozos arbitrarios para verificar el buffer de líneas
    const enc = Buffer.from(sse);
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < enc.length; i += 37) c.enqueue(enc.subarray(i, i + 37)); c.close(); } });
    const f = vi.fn(async (_u: unknown, _i: RequestInit) => new Response(stream, { status: 200 }));
    const r = await new OpenRouterClient(cfg, f as never, sleep0).speech({ model: "openai/gpt-audio-mini", voice: "alloy", text: "hola", instructions: "ins" });
    expect(Buffer.compare(r.pcm, pcm)).toBe(0);
    expect(r.costUsd).toBe(0.01);
    const body = JSON.parse(String(f.mock.calls[0]![1].body));
    expect(body).toMatchObject({ stream: true, modalities: ["text", "audio"], audio: { voice: "alloy", format: "pcm16" } });
  });

  it("extractJson quita fences y texto alrededor", () => {
    expect(extractJson('Claro:\n```json\n{"a":1}\n```\nlisto')).toBe('{"a":1}');
    expect(extractJson('texto {"a":[1,2]} fin')).toBe('{"a":[1,2]}');
  });
});

describe("ZernioPublisher (flujo presign → PUT → post)", () => {
  it("publica con los campos documentados y sube el video por la URL firmada", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zn-"));
    const video = path.join(dir, "final.mp4");
    await fs.writeFile(video, Buffer.alloc(2048, 1));
    const llamadas: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: unknown, init: RequestInit = {}) => {
      llamadas.push({ url: String(url), init });
      if (String(url).endsWith("/media/presign")) return json({ uploadUrl: "https://storage.example/put?sig=1", publicUrl: "https://media.zernio.com/temp/final.mp4", key: "k", expiresIn: 3600 });
      if (String(url).startsWith("https://storage.example")) return new Response(null, { status: 200 });
      return json({ post: { _id: "65f1c0a9e2b5af0012ab34cd", status: "scheduled", platforms: [{ platformPostUrl: "https://instagram.com/reel/abc" }] } }, { status: 201 });
    });
    const z = new ZernioPublisher("sk_test", "https://zernio.com/api/v1", f as never);
    const r = await z.publicar({ videoPath: video, caption: "Hola", cuentas: [{ plataforma: "instagram", accountId: "acc1" }], modo: "programar", programarPara: "2026-10-12T18:30:00-03:00" });
    expect(r).toEqual({ postId: "65f1c0a9e2b5af0012ab34cd", estado: "scheduled", urls: ["https://instagram.com/reel/abc"] });
    expect(llamadas.map((l) => l.url)).toEqual(["https://zernio.com/api/v1/media/presign", "https://storage.example/put?sig=1", "https://zernio.com/api/v1/posts"]);
    expect(JSON.parse(String(llamadas[0]!.init.body))).toEqual({ filename: "final.mp4", contentType: "video/mp4", size: 2048 });
    expect((llamadas[1]!.init.headers as Record<string, string>)["Content-Type"]).toBe("video/mp4");
    expect((llamadas[1]!.init.headers as Record<string, string>)["Authorization"]).toBeUndefined(); // sin auth hacia el storage
    const post = JSON.parse(String(llamadas[2]!.init.body));
    expect(post).toMatchObject({
      content: "Hola",
      mediaItems: [{ type: "video", url: "https://media.zernio.com/temp/final.mp4" }],
      platforms: [{ platform: "instagram", accountId: "acc1", platformSpecificData: { shareToFeed: true } }],
      scheduledFor: "2026-10-12T18:30:00-03:00",
      timezone: "America/Argentina/Buenos_Aires",
    });
    expect(post.publishNow).toBeUndefined();
    expect((llamadas[2]!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk_test");
  });

  it("borrador no manda fecha ni publishNow; 'ahora' manda publishNow", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zn-"));
    const video = path.join(dir, "final.mp4");
    await fs.writeFile(video, "x");
    const cuerpos: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: unknown, init: RequestInit = {}) => {
      if (String(url).endsWith("/media/presign")) return json({ uploadUrl: "https://s.example/p", publicUrl: "https://m.example/v.mp4" });
      if (String(url).startsWith("https://s.example")) return new Response(null, { status: 200 });
      cuerpos.push(JSON.parse(String(init.body)));
      return json({ post: { _id: "1", status: "x", platforms: [] } });
    });
    const z = new ZernioPublisher("k", "https://zernio.com/api/v1", f as never);
    const base = { videoPath: video, caption: "c", cuentas: [{ plataforma: "tiktok", accountId: "t1" }] };
    await z.publicar({ ...base, modo: "borrador" });
    await z.publicar({ ...base, modo: "ahora" });
    expect(cuerpos[0]).not.toHaveProperty("publishNow");
    expect(cuerpos[0]).not.toHaveProperty("scheduledFor");
    expect(cuerpos[1]).toHaveProperty("publishNow", true);
  });

  it("propaga errores de la API y falla sin fecha al programar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zn-"));
    const video = path.join(dir, "v.mp4");
    await fs.writeFile(video, "x");
    const f = vi.fn(async () => new Response('{"error":"bad"}', { status: 401 }));
    await expect(new ZernioPublisher("k", "https://zernio.com/api/v1", f as never).publicar({ videoPath: video, caption: "c", cuentas: [], modo: "ahora" })).rejects.toThrow(/Zernio 401/);
  });
});

describe("anti-SSRF", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1"])("%s es privada", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("%s es pública", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it("rechaza protocolos, credenciales, localhost y hosts que resuelven a IP privada", async () => {
    const privado = async () => ["10.0.0.5"];
    const publico = async () => ["93.184.216.34"];
    await expect(assertPublicUrl("ftp://x.com", publico)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl("http://user:pw@x.com", publico)).rejects.toThrow(/credenciales/);
    await expect(assertPublicUrl("http://localhost:3000", publico)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl("http://app.internal/x", publico)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl("http://evil.com", privado)).rejects.toThrow(/red privada/);
    await expect(assertPublicUrl("http://[::1]/", publico)).rejects.toThrow(/privada/);
    await expect(assertPublicUrl("http://0x7f000001/", publico)).rejects.toThrow(/privada/); // WHATWG lo normaliza a 127.0.0.1
    await expect(assertPublicUrl("http://2130706433/", publico)).rejects.toThrow(/privada/); // IP decimal
  });

  it("valida cada salto de redirección (redirect a 169.254.169.254 se bloquea)", async () => {
    const f = vi.fn(async (u: unknown) => (String(u).includes("ok.com") ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }) : new Response("secreto")));
    await expect(safeFetch("http://ok.com/a", { fetchImpl: f as never, resolve: async (h) => (h === "ok.com" ? ["93.184.216.34"] : ["169.254.169.254"]) })).rejects.toThrow(UnsafeUrlError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("corta descargas que exceden el tope y limita las redirecciones", async () => {
    const grande = vi.fn(async () => new Response(Buffer.alloc(5000), { status: 200 }));
    await expect(safeFetch("http://a.com", { fetchImpl: grande as never, resolve: async () => ["8.8.8.8"], maxBytes: 1000 })).rejects.toThrow(/demasiado grande/);
    const bucle = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://a.com/x" } }));
    await expect(safeFetch("http://a.com", { fetchImpl: bucle as never, resolve: async () => ["8.8.8.8"], maxRedirects: 3 })).rejects.toThrow(/redirecciones/);
  });
});

describe("html", () => {
  it("srcset: elige la de mayor resolución (w y x)", () => {
    expect(bestFromSrcset("a.jpg 400w, b.jpg 1600w, c.jpg 800w")).toBe("b.jpg");
    expect(bestFromSrcset("a.jpg 1x, b.jpg 2x")).toBe("b.jpg");
    expect(bestFromSrcset("solo.jpg")).toBe("solo.jpg");
  });
  it("extrae imágenes lazy/srcset/picture/background, videos y JSON-LD; ignora svg/data:/scripts", () => {
    const r = reducirHtml(
      `<html><head><title>T</title><meta property="og:image" content="/og.jpg"><script type="application/ld+json">{"x":1}</script></head><body>
       <script>var secreto=1</script><img data-lazy-src="/lazy.jpg"><picture><source srcset="/p1.jpg 800w, /p2.jpg 1200w"></picture>
       <div style="background-image:url('/bg.jpg')"></div><img src="/i.svg"><img src="data:image/png;base64,AAAA">
       <video><source src="/v.mp4"></video><iframe src="https://player.vimeo.com/video/1"></iframe><p>Hola</p><footer>pie</footer></body></html>`,
      "https://sitio.com/prop/1",
    );
    expect(r.imagenes.map((i) => i.url)).toEqual(["https://sitio.com/og.jpg", "https://sitio.com/lazy.jpg", "https://sitio.com/p2.jpg", "https://sitio.com/bg.jpg"]);
    expect(r.videos).toEqual([{ url: "https://sitio.com/v.mp4", tipo: "mp4" }, { url: "https://player.vimeo.com/video/1", tipo: "vimeo" }]);
    expect(r.texto).toContain("JSON-LD");
    expect(r.texto).toContain("Hola");
    expect(r.texto).not.toContain("secreto");
    expect(r.texto).not.toContain("pie");
    expect(clasificarVideo("https://youtu.be/x")).toBe("youtube");
  });
});

describe("repararPlan", () => {
  const base = (): EditPlan => editPlanSchema.parse({
    version: 1,
    video: { archivo: "v.mp4", duracion_s: 20, fps: 30, ancho: 1080, alto: 1920 },
    salida: { ancho: 1080, alto: 1920, fps: 30, extension_final_s: 2.5 },
    captions: { fuente: "t.json", grupo_palabras: [2, 4] },
    overlays: [], inserts: [], vo: [], musica: { archivo: null, volumen: 0.1, ducking: true }, guion: "",
  });
  const ov = (id: string, tipo: EditPlan["overlays"][number]["tipo"], inicio: number, fin: number) => ({ id, tipo, inicio, fin, texto: id, subtexto: null, icono: null, posicion: null });
  const ctx = { duracion: 20, extensionFinal: 2.5, imagenes: new Set(["img_001.png", "img_002.png"]) };

  it("recorta tiempos al rango, quita chips superpuestos y agrega tarjeta final y barra", () => {
    const p = base();
    p.overlays = [ov("a", "chip_amenity", 5, 9), ov("b", "chip_amenity", 7, 10), ov("fuera", "lower_third", 40, 50), ov("c", "titulo", -3, 2)];
    const { plan, avisos } = repararPlan(p, ctx);
    const a = plan.overlays.find((o) => o.id === "a")!;
    expect(a.fin).toBe(7); // el chip anterior termina cuando empieza el siguiente
    expect(plan.overlays.find((o) => o.id === "c")!.inicio).toBe(0);
    expect(plan.overlays.find((o) => o.id === "fuera")).toBeUndefined(); // totalmente fuera del video: descartado
    expect(avisos.join()).toMatch(/descartado/);
    expect(plan.overlays.some((o) => o.tipo === "tarjeta_final")).toBe(true);
    expect(plan.overlays.some((o) => o.tipo === "barra_progreso")).toBe(true);
    expect(avisos.join()).toMatch(/tarjeta final/);
    for (const o of plan.overlays) expect(o.fin).toBeLessThanOrEqual(22.5);
  });
  it("inserts: descarta imágenes inexistentes, acota a 4 s, evita solapes y limita al 40 %", () => {
    const p = base();
    const ins = (id: string, imagen: string, inicio: number, fin: number) => ({ id, imagen, inicio, fin, modo: "pantalla_completa" as const, movimiento: "zoom_in" as const });
    p.inserts = [ins("x", "no_existe.png", 1, 3), ins("y", "img_001.png", 2, 9), ins("z", "img_002.png", 5, 7), ins("w", "img_001.png", 12, 15), ins("v", "img_002.png", 16, 19.9)];
    const { plan, avisos } = repararPlan(p, ctx);
    expect(plan.inserts.find((i) => i.id === "x")).toBeUndefined();
    const y = plan.inserts.find((i) => i.id === "y")!;
    expect(y.fin - y.inicio).toBeLessThanOrEqual(3); // acotado y sin pisar a z
    const total = plan.inserts.reduce((s, i) => s + (i.fin - i.inicio), 0);
    expect(total).toBeLessThanOrEqual(20 * 0.4 + 1e-6);
    for (let k = 0; k < plan.inserts.length - 1; k++) expect(plan.inserts[k]!.fin).toBeLessThanOrEqual(plan.inserts[k + 1]!.inicio);
    expect(avisos.length).toBeGreaterThan(0);
  });
});

describe("skills", () => {
  it("todas las skills cargan y tienen trigger, modelo y descripción", () => {
    const s = listSkills();
    expect(s.map((x) => x.id).sort()).toEqual(["capturar", "estilo", "extender", "guion", "imagenes", "prompts", "publicar", "video", "voz"]);
    for (const k of s) {
      expect(k.meta["descripcion"], k.id).toBeTruthy();
      expect(k.meta["trigger"], k.id).toBeTruthy();
      expect(k.meta["agente"], k.id).toBeTruthy();
    }
  });
  it("los prompts que usa el código existen", () => {
    for (const [id, n] of [["capturar", "sistema"], ["prompts", "sistema"], ["extender", "refuerzo"], ["guion", "corregir"], ["guion", "analizar"], ["guion", "plan"], ["voz", "sistema"], ["estilo", "sistema"], ["publicar", "copy"]] as const)
      expect(skillPrompt(id, n, { idioma: "es", tono: "t", instrucciones: "", cta: "c" }).length, `${id}:${n}`).toBeGreaterThan(40);
  });
  it("reemplaza variables {{x}} y parsea frontmatter + secciones", () => {
    const s = parseSkill("t", "---\nname: t\ntrigger: /t\n---\n# Doc\n## prompt:a\nHola {{n}}\n\nlínea 2\n## otra\nno es prompt\n## prompt:b\nB");
    expect(s.meta).toMatchObject({ name: "t", trigger: "/t" });
    expect(s.prompts["a"]).toBe("Hola {{n}}\n\nlínea 2");
    expect(s.prompts["b"]).toBe("B");
    expect(loadSkill("voz").prompts["sistema"]).toContain("{{tono}}");
    expect(skillPrompt("voz", "sistema", { tono: "cálido", idioma: "es-AR", instrucciones: "" })).toContain("cálido");
  });
  it("el prompt de capturar prohíbe inventar datos y el de extender conserva la restricción de no alterar", () => {
    expect(skillPrompt("capturar")).toMatch(/No inventes/);
    expect(skillPrompt("prompts")).toMatch(/Do not alter, move, add or remove/);
  });
});

describe("args, transcripción y utilidades", () => {
  it("parseArgs separa posicionales y flags", () => {
    expect(parseArgs("premium --final --x=1 dos")).toEqual({ pos: ["premium", "dos"], flags: { final: true, x: "1" } });
    expect(parseArgs("")).toEqual({ pos: [], flags: {} });
  });
  it("esUrl y parseFechaAR", () => {
    expect(esUrl("https://a.com/x?y=1")).toBe(true);
    expect(esUrl("hola https://a.com")).toBe(false);
    const ahora = new Date("2026-10-05T12:00:00Z");
    expect(parseFechaAR("2026-10-12 18:30", ahora)).toBe("2026-10-12T18:30:00-03:00");
    expect(parseFechaAR("2026-10-01 18:30", ahora)).toBeNull(); // pasado
    expect(parseFechaAR("mañana", ahora)).toBeNull();
  });
  it("agruparPalabras une tokens, ignora marcas [_BEG_] y paginas() corta por pausas/puntuación", () => {
    const cap = (text: string, s: number, e: number) => ({ text, startMs: s, endMs: e, timestampMs: s, confidence: null });
    const pal = agruparPalabras([cap(" Fin", 0, 200), cap("ca", 200, 400), cap(" Dos", 400, 700), cap("[_BEG_]", 0, 0), cap(" es", 800, 900), cap(" genial.", 900, 1200), cap(" Vení", 3000, 3300)]);
    expect(pal.map((p) => p.texto)).toEqual(["Finca", "Dos", "es", "genial.", "Vení"]);
    const pg = paginas(pal, 2, 4);
    expect(pg.map((p) => p.map((w) => w.texto).join(" "))).toEqual(["Finca Dos es genial.", "Vení"]);
    expect(srtTime(3_723_456)).toBe("01:02:03,456");
    expect(aSrt(pal)).toMatch(/^1\n00:00:00,000 --> 00:00:01,200\nFinca Dos es genial\.\n/);
    expect(aplicarCorrecciones(pal, [{ indice: 0, texto: "FincaDos" }, { indice: 1, texto: "dos palabras" }, { indice: 99, texto: "x" }]).map((p) => p.texto).slice(0, 2)).toEqual(["FincaDos", "Dos"]);
  });
  it("hamming y normalizarAnalisis imponen las reglas de negocio", () => {
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
    const a = { tipo_ambiente: "x", descripcion_corta: "d", calidad: 4, orientacion_original: "vertical" as const, estrategia_extension: "ninguna" as const, prompt_extension: "Extend upward", riesgos: [], usable: true };
    const h = normalizarAnalisis(a, 1600, 1200); // horizontal pero el LLM dijo "ninguna" → se corrige
    expect(h.estrategia_extension).toBe("arriba_y_abajo");
    expect(h.orientacion_original).toBe("horizontal");
    expect(h.prompt_extension).toMatch(/unchanged/i);
    expect(normalizarAnalisis({ ...a, estrategia_extension: "arriba_y_abajo" }, 1080, 1920).estrategia_extension).toBe("ninguna");
  });
});
