import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {}

/** true si la IP es privada, loopback, link-local, multicast, reservada o "unspecified". */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / metadata cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("ff");
  }
  return true;
}

let permitirRedPrivada = false;
/** SOLO PARA TESTS: permite hosts locales (fixtures en localhost). Nunca se llama en producción. */
export function __permitirRedPrivadaSoloTests(v: boolean): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) throw new Error("Solo disponible en tests");
  permitirRedPrivada = v;
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);

/** Valida una URL externa: solo http/https y que TODAS las IPs resueltas sean públicas. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`URL inválida: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(`Protocolo no permitido: ${u.protocol}`);
  if (u.username || u.password) throw new UnsafeUrlError("URL con credenciales no permitida");
  if (permitirRedPrivada) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError(`Host no permitido: ${host}`);
  }
  const ips = net.isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (ips.length === 0) throw new UnsafeUrlError(`No se pudo resolver ${host}`);
  if (ips.some(isPrivateIp)) throw new UnsafeUrlError(`El host ${host} apunta a una red privada`);
  return u;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  resolve?: Resolver;
  fetchImpl?: typeof fetch;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * fetch con: validación anti-SSRF en cada salto de redirección, tope de redirecciones,
 * timeout y tope de bytes (se corta el stream al excederlo).
 */
export async function safeFetch(
  url: string,
  o: SafeFetchOptions = {},
): Promise<{ status: number; contentType: string; body: Buffer; finalUrl: string }> {
  const { timeoutMs = 30_000, maxBytes = 25 * 1024 * 1024, maxRedirects = 5, resolve, fetchImpl = fetch } = o;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current, resolve);
    const signals = [AbortSignal.timeout(timeoutMs), ...(o.signal ? [o.signal] : [])];
    const res = await fetchImpl(u, {
      redirect: "manual",
      signal: AbortSignal.any(signals),
      headers: { "user-agent": UA, accept: "*/*", ...o.headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, u).toString();
      await res.body?.cancel();
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new Error(`Archivo demasiado grande (${declared} bytes > ${maxBytes})`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) throw new Error(`Archivo demasiado grande (> ${maxBytes} bytes)`);
        chunks.push(Buffer.from(chunk));
      }
    }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks), finalUrl: u.toString() };
  }
  throw new Error(`Demasiadas redirecciones (> ${maxRedirects})`);
}

export async function withRetries<T>(fn: (attempt: number) => Promise<T>, tries = 3, baseMs = 500, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    signal?.throwIfAborted();
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (e instanceof UnsafeUrlError) throw e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}
