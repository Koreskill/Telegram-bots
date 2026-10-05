import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPaths, type Paths } from "../src/paths.js";
import { createProject, listClients, listProjects, readManifest, setAgente, updateManifest } from "../src/project/manifest.js";

let paths: Paths;
beforeEach(async () => {
  paths = createPaths(await fs.mkdtemp(path.join(os.tmpdir(), "bot-")));
  await fs.mkdir(paths.clienteDir("demo"), { recursive: true });
});

describe("manifest", () => {
  it("crea proyecto con subcarpetas y manifest válido", async () => {
    const m = await createProject(paths, "demo", "casa-1", "https://x.com/a");
    expect(m.agentes.capturar.estado).toBe("pending");
    for (const sub of ["01_datos", "02_media/originales", "02_media/video_grabado", "05_guion/voz", "06_video"])
      await expect(fs.stat(path.join(paths.proyectoDir("demo", "casa-1"), sub))).resolves.toBeTruthy();
    expect(await listProjects(paths, "demo")).toEqual(["casa-1"]);
    expect(await listClients(paths)).toEqual(["demo"]);
  });
  it("createProject no pisa un manifest existente", async () => {
    await createProject(paths, "demo", "casa-1");
    await setAgente(paths, "demo", "casa-1", "capturar", { estado: "done" });
    const again = await createProject(paths, "demo", "casa-1");
    expect(again.agentes.capturar.estado).toBe("done");
  });
  it("50 actualizaciones concurrentes no pierden escrituras y suman costos", async () => {
    await createProject(paths, "demo", "casa-1");
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        updateManifest(paths, "demo", "casa-1", (m) => {
          m.agentes.extender.aprobadas = [...(m.agentes.extender.aprobadas ?? []), `img_${i}`];
          m.agentes.extender.costo_usd = (m.agentes.extender.costo_usd ?? 0) + 0.01;
        }),
      ),
    );
    const m = await readManifest(paths, "demo", "casa-1");
    expect(m.agentes.extender.aprobadas).toHaveLength(50);
    expect(m.costo_total_usd).toBeCloseTo(0.5, 6);
  });
  it("la escritura es atómica: nunca queda JSON a medias ni temporales", async () => {
    await createProject(paths, "demo", "casa-1");
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => setAgente(paths, "demo", "casa-1", "guion", { mensaje: "x".repeat(i * 100) })),
    );
    const raw = await fs.readFile(paths.manifest("demo", "casa-1"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    const left = (await fs.readdir(paths.proyectoDir("demo", "casa-1"))).filter((f) => f.endsWith(".tmp"));
    expect(left).toEqual([]);
  });
  it("rechaza un manifest corrupto en lugar de devolver basura", async () => {
    await createProject(paths, "demo", "casa-1");
    await fs.writeFile(paths.manifest("demo", "casa-1"), '{"version":2}');
    await expect(readManifest(paths, "demo", "casa-1")).rejects.toThrow();
  });
});
