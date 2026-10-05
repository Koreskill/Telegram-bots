import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Worker } from "../src/queue/queue.js";
import { enqueueAgent, registerAgents } from "../src/agents/registry.js";
import { readManifest } from "../src/project/manifest.js";
import { crearCliente, fixtureServer, makeEnv, type Env, type Fixture } from "./helpers.js";
import type { Sender } from "../src/telegram/send.js";
import type { AgentResult } from "../src/agents/context.js";

let env: Env;
let fx: Fixture;

class FakeSender implements Sender {
  resultados: { chat: number; r: AgentResult }[] = [];
  textos: string[] = [];
  progresos: string[] = [];
  async progress(_c: number, initial: string) {
    this.progresos.push(initial);
    return { update: () => undefined, finish: async (t: string) => void this.progresos.push(t) };
  }
  async result(chat: number, r: AgentResult) { this.resultados.push({ chat, r }); }
  async text(_c: number, t: string) { this.textos.push(t); }
}

beforeAll(async () => { env = await makeEnv(); fx = await fixtureServer(); });
afterAll(async () => { await fx.close(); await env.cleanup(); });

async function correr(worker: Worker, esperados: number, sender: FakeSender) {
  for (let i = 0; i < 80 && sender.resultados.length < esperados; i++) { await worker.tick(); await new Promise((r) => setTimeout(r, 50)); }
  await worker.idle();
}

describe("registro de agentes en la cola", () => {
  it("/todo: capturar → imagenes → prompts se encadenan solos y se detienen en la aprobación", async () => {
    const cliente = await crearCliente(env, "Todo Cliente");
    const sender = new FakeSender();
    const worker = new Worker(env.store);
    registerAgents(worker, env.deps, env.store, env.paths, sender);
    enqueueAgent(env.store, { tipo: "capturar", chatId: 7, cliente, proyecto: null, args: { url: `${fx.base}/propiedad.html`, auto: true } });
    await correr(worker, 3, sender);

    expect(sender.resultados.map((x) => x.chat)).toEqual([7, 7, 7]);
    const botones = sender.resultados.map((x) => x.r.botones?.flat().map((b) => b.data));
    expect(botones[0]).toContain("next:imagenes");
    expect(botones[2]).toContain("next:extender"); // se detiene acá: hay que aprobar
    const estado = env.store.getChatState(7);
    expect(estado.cliente).toBe(cliente);
    expect(estado.proyecto).toMatch(/finca-dos/);
    const m = await readManifest(env.paths, cliente, estado.proyecto!);
    expect(m.auto).toBe(true);
    expect(["capturar", "imagenes", "prompts"].map((a) => (m.agentes as any)[a].estado)).toEqual(["done", "done", "done"]);
    expect(m.agentes.extender.estado).toBe("pending"); // no corrió solo
    expect(sender.resultados[1]!.r.media?.length).toBeGreaterThan(0);
    // un último tick no debe lanzar nada más
    await worker.tick(); await worker.idle();
    expect(env.store.list(["queued", "running"])).toHaveLength(0);
  });

  it("sin /todo no hay encadenado: cada agente espera la acción del usuario", async () => {
    const cliente = await crearCliente(env, "Manual");
    const sender = new FakeSender();
    const worker = new Worker(env.store);
    registerAgents(worker, env.deps, env.store, env.paths, sender);
    enqueueAgent(env.store, { tipo: "capturar", chatId: 8, cliente, proyecto: null, args: { url: `${fx.base}/propiedad.html` } });
    await correr(worker, 1, sender);
    await new Promise((r) => setTimeout(r, 300));
    await worker.tick(); await worker.idle();
    expect(sender.resultados).toHaveLength(1);
    expect(env.store.list(["queued", "running"])).toHaveLength(0);
  });

  it("un agente que falla: el job queda en error, el manifest también y se avisa", async () => {
    const cliente = await crearCliente(env, "Falla");
    const sender = new FakeSender();
    const errores: string[] = [];
    const worker = new Worker(env.store, { onError: (_j, e) => void errores.push(e) });
    registerAgents(worker, env.deps, env.store, env.paths, sender);
    const { createProject } = await import("../src/project/manifest.js");
    await createProject(env.paths, cliente, "vacio");
    const job = enqueueAgent(env.store, { tipo: "prompts", chatId: 9, cliente, proyecto: "vacio" });
    for (let i = 0; i < 20 && env.store.get(job.id)?.estado !== "error"; i++) { await worker.tick(); await new Promise((r) => setTimeout(r, 30)); }
    await worker.idle();
    expect(env.store.get(job.id)?.estado).toBe("error");
    expect(errores[0]).toMatch(/Primero ejecutá \/imagenes/);
    expect((await readManifest(env.paths, cliente, "vacio")).agentes.prompts).toMatchObject({ estado: "error" });
    expect(sender.progresos.at(-1)).toMatch(/falló/);
  });

  it("cancelar un job en curso lo deja 'cancelled' y el agente vuelve a pending", async () => {
    const cliente = await crearCliente(env, "Cancel");
    const sender = new FakeSender();
    const worker = new Worker(env.store);
    registerAgents(worker, { ...env.deps, llm: { ...env.deps.llm, json: (r: { signal?: AbortSignal }) => new Promise((_res, rej) => r.signal?.addEventListener("abort", () => rej(new Error("abortado")))), image: env.llm.image.bind(env.llm), speech: env.llm.speech.bind(env.llm) } as never }, env.store, env.paths, sender);
    enqueueAgent(env.store, { tipo: "capturar", chatId: 10, cliente, proyecto: null, args: { url: `${fx.base}/propiedad.html` } });
    await worker.tick();
    await new Promise((r) => setTimeout(r, 200));
    expect(worker.cancelAllFor(10)).toBe(1);
    await worker.idle();
    expect(env.store.list(["cancelled"]).length).toBe(1);
    expect(sender.progresos.at(-1)).toMatch(/Cancelado/);
  });
});
