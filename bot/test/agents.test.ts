import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { capturar } from "../src/agents/1-capturar.js";
import { imagenes } from "../src/agents/2-imagenes.js";
import { prompts } from "../src/agents/3-prompts.js";
import { aprobarImagen, aprobarTodas, extender, leerEstado } from "../src/agents/4-extender.js";
import { guion } from "../src/agents/5-guion.js";
import { voz } from "../src/agents/5b-voz.js";
import { estilos } from "../src/agents/6a-estilo.js";
import { video } from "../src/agents/6-video.js";
import { ejecutarPublicacion, publicar } from "../src/agents/9-publicar.js";
import { BudgetError } from "../src/agents/context.js";
import { editPlanSchema } from "../src/schemas/plan.js";
import { propiedadSchema, imagenIndiceSchema } from "../src/schemas/propiedad.js";
import { readManifest } from "../src/project/manifest.js";
import { readJson } from "../src/lib/hash.js";
import { duracionAudio, probe } from "../src/lib/ffmpeg.js";
import { crearCliente, fixtureServer, makeEnv, makeVideo, type Env, type Fixture } from "./helpers.js";

let env: Env;
let fx: Fixture;
let cliente: string;
let slug: string;

beforeAll(async () => {
  env = await makeEnv();
  fx = await fixtureServer();
  cliente = await crearCliente(env);
});
afterAll(async () => {
  await fx.close();
  await env.cleanup();
});

const proj = (...p: string[]) => path.join(env.paths.proyectoDir(cliente, slug), ...p);

describe("pipeline completo (MOCK=1, sin gastar créditos)", () => {
  it("Agente 1 · capturar: crea el proyecto con estructura y propiedad.json válido", async () => {
    const ctx = env.ctx(cliente, "");
    const r = await capturar(ctx, `${fx.base}/propiedad.html`);
    slug = r.slug;
    expect(slug).toMatch(/finca-dos/);
    const prop = propiedadSchema.parse(await readJson(proj("01_datos", "propiedad.json")));
    expect(prop.ubicacion.barrio).toBe("Finca Dos");
    // Imágenes extraídas de forma determinista: srcset → la de mayor resolución, og:image sin duplicar.
    const urls = prop.imagenes.map((i) => i.url.replace(fx.base, ""));
    expect(urls).toContain("/img/a.jpg");
    expect(urls).not.toContain("/img/a-dup.jpg");
    expect(prop.videos[0]?.tipo).toBe("youtube");
    for (const d of ["01_datos", "02_media/originales", "02_media/video_grabado", "03_prompts", "04_extendidas", "05_guion/voz", "06_video"])
      await expect(fs.stat(proj(d))).resolves.toBeTruthy();
    const m = await readManifest(env.paths, cliente, slug);
    expect(m.agentes.capturar.estado).toBe("done");
    expect(m.url_origen).toContain("/propiedad.html");
    expect(r.botones?.[0]?.[0]?.data).toBe("next:imagenes");
  });

  it("Agente 1 · rechaza URLs privadas (anti-SSRF) incluso con redirección", async () => {
    const { __permitirRedPrivadaSoloTests } = await import("../src/lib/net.js");
    __permitirRedPrivadaSoloTests(false);
    try {
      await expect(capturar(env.ctx(cliente, ""), "http://localhost/x")).rejects.toThrow(/no permitido|privada/i);
      await expect(capturar(env.ctx(cliente, ""), "http://169.254.169.254/latest")).rejects.toThrow(/privada/i);
      await expect(capturar(env.ctx(cliente, ""), "file:///etc/passwd")).rejects.toThrow(/Protocolo/);
    } finally {
      __permitirRedPrivadaSoloTests(true);
    }
  });

  it("Agente 2 · imagenes: descarga, descarta logo/miniatura/rota, deduplica y numera", async () => {
    const r = await imagenes(env.ctx(cliente, slug));
    const idx = imagenIndiceSchema.parse(await readJson(proj("02_media", "originales", "indice.json")));
    expect(idx.imagenes.map((i) => i.archivo)).toEqual(["img_001.jpg", "img_002.jpg", "img_003.jpg"]);
    expect(idx.imagenes.map((i) => i.orientacion)).toEqual(["horizontal", "horizontal", "vertical"]);
    const motivos = idx.descartadas.map((d) => d.motivo).join("|");
    expect(motivos).toMatch(/muy chica/); // logo y miniatura
    expect(motivos).toMatch(/404|HTTP/); // imagen rota
    expect(r.texto).toContain("3 imágenes");
    for (const i of idx.imagenes) expect((await sharp(proj("02_media", "originales", i.archivo)).metadata()).format).toBe("jpeg");
    expect((await readManifest(env.paths, cliente, slug)).agentes.imagenes.estado).toBe("done");
  });

  it("Idempotencia: repetir /imagenes con las mismas entradas no rehace nada (salvo --forzar)", async () => {
    const antes = fx.hits.length;
    const r = await imagenes(env.ctx(cliente, slug));
    expect(r.texto).toMatch(/ya estaba hecho/);
    expect(fx.hits.length).toBe(antes);
    await imagenes(env.ctx(cliente, slug, { forzar: true }));
    expect(fx.hits.length).toBeGreaterThan(antes);
  });

  it("Agente 3 · prompts: 1 JSON por imagen, vertical sin extender, restricción siempre presente", async () => {
    const r = await prompts(env.ctx(cliente, slug));
    const p1 = await readJson<{ estrategia_extension: string; prompt_extension: string; archivo: string }>(proj("03_prompts", "img_001.json"));
    const p3 = await readJson<{ estrategia_extension: string }>(proj("03_prompts", "img_003.json"));
    expect(p1.estrategia_extension).toBe("arriba_y_abajo");
    expect(p1.prompt_extension).toMatch(/unchanged/i);
    expect(p3.estrategia_extension).toBe("ninguna");
    await expect(fs.stat(proj("03_prompts", "resumen.md"))).resolves.toBeTruthy();
    expect(r.botones?.flat().some((b) => b.data === "ep:img_001")).toBe(true);
    expect(r.botones?.flat().some((b) => b.data === "next:extender")).toBe(true);
  });

  it("Agente 4 · extender: 1080×1920 exactos, centro conservado, vertical sin IA, aprobaciones", async () => {
    const antes = env.llm.calls.image;
    const r = await extender(env.ctx(cliente, slug));
    expect(env.llm.calls.image - antes).toBe(2); // solo las 2 horizontales usan IA
    for (const n of ["img_001", "img_002", "img_003"]) {
      const m = await sharp(proj("04_extendidas", `${n}.png`)).metadata();
      expect([m.width, m.height]).toEqual([1080, 1920]);
    }
    const est = await leerEstado({ paths: env.paths, cliente, slug });
    expect(est["img_001"]).toMatchObject({ metodo: "ia", estado: "pendiente" });
    expect(est["img_003"]).toMatchObject({ metodo: "original" });
    expect(r.media).toHaveLength(3);
    expect(r.media?.[0]?.botones?.[0]?.map((b) => b.data)).toEqual(["rg:img_001", "bl:img_001", "ok:img_001"]);

    await aprobarImagen({ paths: env.paths, cliente, slug }, "img_001");
    expect((await readManifest(env.paths, cliente, slug)).agentes.extender.aprobadas).toEqual(["img_001"]);
    // Regenerar una imagen puntual la saca de las aprobadas y no toca las demás.
    await extender(env.ctx(cliente, slug, { solo: ["img_001"] }));
    expect((await readManifest(env.paths, cliente, slug)).agentes.extender.aprobadas).toEqual([]);
    // Blur determinista sin IA
    const n = env.llm.calls.image;
    await extender(env.ctx(cliente, slug, { solo: ["img_002"], blur: true }));
    expect(env.llm.calls.image).toBe(n);
    expect((await leerEstado({ paths: env.paths, cliente, slug }))["img_002"]?.metodo).toBe("blur");
    expect(await aprobarTodas({ paths: env.paths, cliente, slug })).toBe(3);
  });

  it("Agente 4 · respeta el tope de gasto por proyecto", async () => {
    const caro = await makeEnv({ MAX_USD_PER_PROJECT: "0.0001" });
    try {
      const c = await crearCliente(caro, "Caro");
      const r = await capturar(caro.ctx(c, ""), `${fx.base}/propiedad.html`);
      await imagenes(caro.ctx(c, r.slug));
      await prompts(caro.ctx(c, r.slug));
      // simula gasto previo del proyecto por encima del tope
      const { setAgente } = await import("../src/project/manifest.js");
      await setAgente(caro.paths, c, r.slug, "prompts", { costo_usd: 1 });
      await expect(extender(caro.ctx(c, r.slug))).rejects.toThrow(BudgetError);
      expect((await readManifest(caro.paths, c, r.slug)).agentes.extender.estado).toBe("error");
    } finally {
      await caro.cleanup();
    }
  });

  it("Agente 5 · guion: sin video avisa; con video arma transcripción, SRT, análisis y plan válido", async () => {
    await expect(guion(env.ctx(cliente, slug))).rejects.toThrow(/\/subir/);
    await makeVideo(proj("02_media", "video_grabado", "original.mp4"), 12);
    const r = await guion(env.ctx(cliente, slug));
    const plan = editPlanSchema.parse(await readJson(proj("05_guion", "edit-plan.json")));
    expect(plan.video.duracion_s).toBeGreaterThan(11);
    expect(plan.salida).toMatchObject({ ancho: 1080, alto: 1920 });
    expect(plan.overlays.some((o) => o.tipo === "tarjeta_final")).toBe(true);
    expect(plan.overlays.some((o) => o.tipo === "barra_progreso")).toBe(true);
    for (const i of plan.inserts) await expect(fs.stat(proj("04_extendidas", i.imagen))).resolves.toBeTruthy();
    expect(await fs.readFile(proj("05_guion", "subtitulos.srt"), "utf8")).toMatch(/00:00:00,000 --> /);
    await expect(fs.stat(proj("05_guion", "guion.md"))).resolves.toBeTruthy();
    await expect(fs.stat(proj("05_guion", "analisis.json"))).resolves.toBeTruthy();
    expect(r.botones?.flat().map((b) => b.data)).toEqual(expect.arrayContaining(["next:video", "pl:cambios", "st:edit"]));
    expect(r.botones?.flat().map((b) => b.data)).not.toContain("next:voz"); // sin voz en off pedida
  });

  it("Agente 5 · pedir cambios reutiliza transcripción/análisis y conserva lo demás", async () => {
    const antes = env.llm.calls.json;
    await guion(env.ctx(cliente, slug, { cambios: "sacá el título", voz: true }));
    expect(env.llm.calls.json - antes).toBe(1); // solo la llamada del plan
    const plan = editPlanSchema.parse(await readJson(proj("05_guion", "edit-plan.json")));
    expect(plan.vo.length).toBeGreaterThan(0);
  });

  it("Agente 5b · voz: genera WAV normalizado y actualiza duración en el plan", async () => {
    const r = await voz(env.ctx(cliente, slug));
    const plan = editPlanSchema.parse(await readJson(proj("05_guion", "edit-plan.json")));
    expect(plan.vo[0]?.archivo).toBe("05_guion/voz/vo_001.wav");
    expect(plan.vo[0]?.duracion_s).toBeGreaterThan(0.5);
    expect(await duracionAudio(proj("05_guion", "voz", "vo_001.wav"))).toBeGreaterThan(0.5);
    expect(r.media?.[0]?.botones?.[0]?.[0]?.data).toBe("vr:vo1");
  });

  it("Agente 6a · estilos: analiza el video de referencia y escribe estilo.json", async () => {
    const dir = path.join(env.paths.estilosDir, "premium");
    await makeVideo(path.join(dir, "referencia.mp4"), 4);
    const r = await estilos(env.ctx(cliente, slug));
    const est = await readJson<{ nombre: string }>(path.join(dir, "estilo.json"));
    expect(est.nombre).toBe("premium");
    expect(r.texto).toMatch(/premium/);
    await expect(fs.stat(path.join(dir, "_frames"))).rejects.toBeTruthy(); // limpió temporales
  });

  it("Agente 6 · video: borrador a media resolución y final 1080×1920 con thumbnail", async () => {
    const b = await video(env.ctx(cliente, slug, { estilo: "premium" }));
    expect(b.botones?.flat().map((x) => x.data)).toContain("vf:final");
    const ib = await probe(proj("06_video", "borrador.mp4"));
    expect([ib.ancho, ib.alto]).toEqual([540, 960]);
    const f = await video(env.ctx(cliente, slug, { final: true }));
    const info = await probe(proj("06_video", "final.mp4"));
    expect([info.ancho, info.alto]).toEqual([1080, 1920]);
    await expect(fs.stat(proj("06_video", "thumbnail.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(proj("06_video", "_public"))).rejects.toBeTruthy(); // limpió el directorio público
    expect(f.media?.[0]?.tipo).toBe("video");
    expect((await readManifest(env.paths, cliente, slug)).agentes.video.estado).toBe("done");
  });

  it("Agente 9 · publicar: vista previa NO publica; solo la confirmación explícita publica", async () => {
    await expect(publicar(env.ctx(cliente, slug))).rejects.toThrow(/cuentas de Zernio/);
    const cj = env.paths.clienteJson(cliente);
    const c = await readJson<Record<string, unknown>>(cj);
    await fs.writeFile(cj, JSON.stringify({ ...c, zernio: { cuentas: [{ plataforma: "instagram", accountId: "acc1" }] } }));
    const prev = await publicar(env.ctx(cliente, slug));
    expect(prev.texto).toMatch(/No se publica nada hasta que confirmes/);
    expect(env.publisher.llamadas).toHaveLength(0);
    expect(prev.botones?.flat().map((b) => b.data)).toEqual(expect.arrayContaining(["pub:ahora", "pub:borrador", "pub:prog", "pub:cancel"]));

    const borrador = await ejecutarPublicacion(env.ctx(cliente, slug), "borrador");
    expect(borrador.texto).toMatch(/borrador/);
    expect(env.publisher.llamadas[0]).toMatchObject({ modo: "borrador", cuentas: [{ plataforma: "instagram", accountId: "acc1" }] });
    const prog = await ejecutarPublicacion(env.ctx(cliente, slug), "programar", "2026-10-12T18:30:00-03:00");
    expect(prog.texto).toMatch(/Programado/);
    expect(env.publisher.llamadas[1]?.programarPara).toBe("2026-10-12T18:30:00-03:00");
    expect((await readManifest(env.paths, cliente, slug)).agentes.publicar.estado).toBe("done");
  });
});
