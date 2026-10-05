import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserFetcher, findChromium } from "../src/lib/browser.js";
import { __permitirRedPrivadaSoloTests } from "../src/lib/net.js";
import { fixtureServer, type Fixture } from "./helpers.js";

const maybe = findChromium() ? describe : describe.skip;

maybe("BrowserFetcher con Chromium real", () => {
  let fx: Fixture;
  beforeAll(async () => { __permitirRedPrivadaSoloTests(true); fx = await fixtureServer(); });
  afterAll(async () => fx.close());

  it("renderiza la página con JavaScript y devuelve HTML + captura", async () => {
    const r = await new BrowserFetcher().fetch(`${fx.base}/propiedad.html`);
    expect(r.via).toBe("navegador");
    expect(r.html).toContain("Casa en Finca Dos");
    expect(r.screenshot && r.screenshot.length).toBeGreaterThan(1000);
  });

  it("el navegador bloquea las subpeticiones a redes privadas (SSRF vía la página)", async () => {
    __permitirRedPrivadaSoloTests(false);
    try {
      await expect(new BrowserFetcher().fetch("http://127.0.0.1:1/x")).rejects.toThrow(/privada|no permitido/i);
    } finally {
      __permitirRedPrivadaSoloTests(true);
    }
  });
});
