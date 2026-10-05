import fs from "node:fs";
import path from "node:path";
import { assertPublicUrl, safeFetch } from "./net.js";

export interface Pagina {
  html: string;
  screenshot: Buffer | null;
  finalUrl: string;
  via: "navegador" | "http";
}

export interface PageFetcher {
  fetch(url: string, o?: { signal?: AbortSignal }): Promise<Pagina>;
}

/** Busca un Chromium: CHROMIUM_PATH, o el instalado por Playwright (PLAYWRIGHT_BROWSERS_PATH). */
export function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  try {
    for (const d of fs.readdirSync(root).sort().reverse()) {
      if (!d.startsWith("chromium")) continue;
      for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-linux/headless_shell", "chrome"]) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    /* sin navegador local */
  }
  return undefined;
}

/**
 * Descarga la página con Chromium headless (ejecuta JS, scroll para lazy-load, captura de pantalla).
 * Cada subpetición del navegador también pasa por la validación anti-SSRF.
 * Si el navegador no está disponible o falla, cae a un GET simple.
 */
export class BrowserFetcher implements PageFetcher {
  async fetch(url: string, o: { signal?: AbortSignal } = {}): Promise<Pagina> {
    await assertPublicUrl(url);
    try {
      return await this.conNavegador(url, o.signal);
    } catch (e) {
      const r = await safeFetch(url, { signal: o.signal, maxBytes: 8 * 1024 * 1024 });
      if (r.status >= 400) throw new Error(`La página respondió ${r.status} (navegador: ${e instanceof Error ? e.message : e})`);
      return { html: r.body.toString("utf8"), screenshot: null, finalUrl: r.finalUrl, via: "http" };
    }
  }

  private async conNavegador(url: string, signal?: AbortSignal): Promise<Pagina> {
    const { chromium } = await import("playwright-core");
    const executablePath = findChromium();
    const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const onAbort = () => void browser.close().catch(() => undefined);
    signal?.addEventListener("abort", onAbort);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "es-AR" });
      const page = await ctx.newPage();
      const okHosts = new Map<string, boolean>();
      await page.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
        let ok = okHosts.get(u.hostname);
        if (ok === undefined) {
          ok = await assertPublicUrl(u.toString()).then(() => true, () => false);
          okHosts.set(u.hostname, ok);
        }
        return ok ? route.continue() : route.abort("blockedbyclient");
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      // Scroll hasta el final para disparar lazy-load.
      await page.evaluate(async () => {
        let y = 0;
        for (let i = 0; i < 40; i++) {
          window.scrollTo(0, (y += 900));
          await new Promise((r) => setTimeout(r, 150));
          if (y >= document.body.scrollHeight) break;
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      const html = await page.content();
      const screenshot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 70 }).catch(() => null);
      return { html, screenshot, finalUrl: page.url(), via: "navegador" };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await browser.close().catch(() => undefined);
    }
  }
}

/** Descarga sin navegador (solo HTML estático). Útil en tests y como respaldo. */
export class HttpFetcher implements PageFetcher {
  async fetch(url: string, o: { signal?: AbortSignal } = {}): Promise<Pagina> {
    const r = await safeFetch(url, { signal: o.signal, maxBytes: 8 * 1024 * 1024 });
    if (r.status >= 400) throw new Error(`La página respondió ${r.status}`);
    return { html: r.body.toString("utf8"), screenshot: null, finalUrl: r.finalUrl, via: "http" };
  }
}
