import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { capturar } from "../src/agents/1-capturar.js";
import { imagenes } from "../src/agents/2-imagenes.js";
import { prompts } from "../src/agents/3-prompts.js";
import { extender, aprobarTodas } from "../src/agents/4-extender.js";
import { guion } from "../src/agents/5-guion.js";
import { RemotionCliRenderer, findRemotionDir } from "../src/agents/6-video.js";
import { video } from "../src/agents/6-video.js";
import { probe, run } from "../src/lib/ffmpeg.js";
import { crearCliente, fixtureServer, makeEnv, makeVideo, type Env, type Fixture } from "./helpers.js";

/** Render REAL con Remotion + Chromium. Se omite si no hay navegador o no está instalado my-video/node_modules. */
const candidatos = [process.env.REMOTION_BROWSER_EXECUTABLE, "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].filter((x): x is string => !!x);
const browser = candidatos.find((p) => fs.existsSync(p));
let remotionOk = false;
try {
  remotionOk = fs.existsSync(path.join(findRemotionDir(), "node_modules", "remotion"));
} catch {
  remotionOk = false;
}
const maybe = browser && remotionOk ? describe : describe.skip;

maybe("render real con Remotion", () => {
  let env: Env;
  let fx: Fixture;
  beforeAll(async () => {
    process.env.REMOTION_BROWSER_EXECUTABLE = browser;
    env = await makeEnv({ RENDER_CONCURRENCY: "2" });
    env.deps.renderer = new RemotionCliRenderer();
    fx = await fixtureServer();
  });
  afterAll(async () => {
    await fx?.close();
    await env?.cleanup();
  });

  it("agente 6 genera un borrador real 540×960 con video horizontal, subtítulos, overlays e inserts", async () => {
    const cliente = await crearCliente(env, "Render Cliente");
    const { slug } = await capturar(env.ctx(cliente, ""), `${fx.base}/propiedad.html`);
    await imagenes(env.ctx(cliente, slug));
    await prompts(env.ctx(cliente, slug));
    await extender(env.ctx(cliente, slug));
    await aprobarTodas({ paths: env.paths, cliente, slug });
    await makeVideo(path.join(env.paths.proyectoDir(cliente, slug), "02_media/video_grabado/original.mp4"), 10, { size: "640x360" });
    await guion(env.ctx(cliente, slug));

    const prog: number[] = [];
    const ctx = env.ctx(cliente, slug);
    const r = await video({ ...ctx, progress: (t) => void prog.push(Number(/(\d+)%/.exec(t)?.[1] ?? -1)) });
    const out = path.join(env.paths.proyectoDir(cliente, slug), "06_video/borrador.mp4");
    const info = await probe(out);
    expect([info.ancho, info.alto]).toEqual([540, 960]);
    expect(info.duracion_s).toBeGreaterThan(12); // 10 s + 2,5 s de tarjeta final
    expect(info.tieneAudio).toBe(true);
    expect(r.texto).toMatch(/Borrador listo/);
    expect(prog.some((p) => p > 0)).toBe(true); // se reportó progreso

    // El render no es una pantalla en negro: hay contenido en un fotograma intermedio.
    const frame = path.join(env.dir, "f.png");
    await run("ffmpeg", ["-y", "-ss", "4", "-i", out, "-frames:v", "1", frame]);
    const { stdout } = await run("ffmpeg", ["-i", frame, "-vf", "signalstats,metadata=print", "-f", "null", "-"]).then(
      (x) => ({ stdout: x.stderr }),
    );
    const yavg = Number(/YAVG=([0-9.]+)/.exec(stdout)?.[1] ?? 0);
    expect(yavg).toBeGreaterThan(20);
    fs.copyFileSync(frame, "/tmp/render_frame_4s.png");
  });
});
