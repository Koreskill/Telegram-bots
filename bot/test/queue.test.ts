import { describe, expect, it } from "vitest";
import { JobStore, Worker } from "../src/queue/queue.js";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("cola", () => {
  it("encola, ejecuta y marca done", async () => {
    const store = new JobStore(":memory:");
    const w = new Worker(store);
    let ran = 0;
    w.register("x", async () => void ran++);
    const j = store.enqueue({ tipo: "x" });
    await w.tick();
    await w.idle();
    expect(ran).toBe(1);
    expect(store.get(j.id)?.estado).toBe("done");
  });
  it("heavy corre de a uno; light hasta 3 en paralelo", async () => {
    const store = new JobStore(":memory:");
    const w = new Worker(store);
    let heavyNow = 0, heavyMax = 0, lightNow = 0, lightMax = 0;
    w.register("h", async () => { heavyMax = Math.max(heavyMax, ++heavyNow); await tick(); heavyNow--; });
    w.register("l", async () => { lightMax = Math.max(lightMax, ++lightNow); await tick(); lightNow--; });
    for (let i = 0; i < 3; i++) store.enqueue({ tipo: "h", clase: "heavy" });
    for (let i = 0; i < 6; i++) store.enqueue({ tipo: "l", clase: "light" });
    for (let i = 0; i < 20; i++) { await w.tick(); await tick(10); }
    await w.idle();
    expect(heavyMax).toBe(1);
    expect(lightMax).toBe(3);
    expect(store.list(["done"], 50)).toHaveLength(9);
  });
  it("un handler que falla deja el job en error y avisa", async () => {
    const store = new JobStore(":memory:");
    const errors: string[] = [];
    const w = new Worker(store, { onError: (_j, e) => void errors.push(e) });
    w.register("boom", async () => { throw new Error("falló"); });
    const j = store.enqueue({ tipo: "boom" });
    await w.tick(); await w.idle();
    expect(store.get(j.id)).toMatchObject({ estado: "error", error: "falló" });
    expect(errors).toEqual(["falló"]);
  });
  it("tipo sin handler → error claro", async () => {
    const store = new JobStore(":memory:");
    const w = new Worker(store);
    const j = store.enqueue({ tipo: "nada" });
    await w.tick(); await w.idle();
    expect(store.get(j.id)?.error).toMatch(/no implementado/);
  });
  it("recupera jobs 'running' al reiniciar", () => {
    const store = new JobStore(":memory:");
    const a = store.enqueue({ tipo: "x", chatId: 7 });
    store.enqueue({ tipo: "x" });
    store.claimNext("light"); // a queda running
    const rec = store.recoverOnStart();
    expect(rec.map((j) => j.id)).toEqual([a.id]);
    expect(store.get(a.id)).toMatchObject({ estado: "error", error: "reinicio" });
    expect(store.list(["queued"])).toHaveLength(1);
  });
  it("cancelar aborta un job en ejecución y uno en cola", async () => {
    const store = new JobStore(":memory:");
    const w = new Worker(store, {}, { heavy: 1, light: 1 });
    w.register("largo", (_j, { signal }) => new Promise<void>((res) => signal.addEventListener("abort", () => res())));
    const run = store.enqueue({ tipo: "largo", chatId: 1 });
    const wait = store.enqueue({ tipo: "largo", chatId: 1 });
    await w.tick();
    expect(store.get(run.id)?.estado).toBe("running");
    expect(w.cancelAllFor(1)).toBe(2);
    await w.idle();
    expect(store.get(run.id)?.estado).toBe("cancelled");
    expect(store.get(wait.id)?.estado).toBe("cancelled");
  });
  it("persiste cliente/proyecto activos por chat", () => {
    const store = new JobStore(":memory:");
    store.setChatState(1, { cliente: "a" });
    store.setChatState(1, { proyecto: "p" });
    expect(store.getChatState(1)).toEqual({ cliente: "a", proyecto: "p" });
    expect(store.getChatState(2)).toEqual({ cliente: null, proyecto: null });
  });
});
