import * as cheerio from "cheerio";

export interface Candidato {
  url: string;
  alt: string | null;
}
export interface VideoCand {
  url: string;
  tipo: "mp4" | "youtube" | "vimeo" | "otro";
}
export interface Reducido {
  texto: string;
  imagenes: Candidato[];
  videos: VideoCand[];
}

const abs = (raw: string | undefined, base: string): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("javascript:")) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** De un srcset elige la URL de mayor resolución (descriptor w o x). */
export function bestFromSrcset(srcset: string): string | null {
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const score = desc ? parseFloat(desc) * (desc.endsWith("x") ? 1000 : 1) : 1;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

const NOT_PHOTO = /\.(svg|ico|gif)(\?|#|$)/i;

export function clasificarVideo(url: string): VideoCand["tipo"] {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url)) return "mp4";
  return "otro";
}

export function reducirHtml(html: string, baseUrl: string, maxChars = 40_000): Reducido {
  const $ = cheerio.load(html);
  const imagenes: Candidato[] = [];
  const seen = new Set<string>();
  const addImg = (raw: string | undefined, alt: string | null) => {
    const u = abs(raw, baseUrl);
    if (!u || NOT_PHOTO.test(u) || seen.has(u)) return;
    seen.add(u);
    imagenes.push({ url: u, alt: alt?.trim() || null });
  };

  // Metadatos útiles antes de eliminar scripts.
  const meta: string[] = [];
  const title = $("title").first().text().trim();
  if (title) meta.push(`TITLE: ${title}`);
  $('meta[name="description"], meta[property^="og:"]').each((_, el) => {
    const k = $(el).attr("property") ?? $(el).attr("name");
    const v = $(el).attr("content");
    if (k && v && k !== "og:image") meta.push(`${k}: ${v}`);
  });
  addImg($('meta[property="og:image"]').attr("content"), null);
  const ld: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t) ld.push(t.slice(0, 6000));
  });

  const videos: VideoCand[] = [];
  const vSeen = new Set<string>();
  const addVid = (raw: string | undefined) => {
    const u = abs(raw, baseUrl);
    if (!u || vSeen.has(u)) return;
    vSeen.add(u);
    videos.push({ url: u, tipo: clasificarVideo(u) });
  };

  $("img").each((_, el) => {
    const a = $(el).attr() ?? {};
    const srcset = a["srcset"] ?? a["data-srcset"];
    const alt = a["alt"] ?? null;
    addImg((srcset && bestFromSrcset(srcset)) || a["data-src"] || a["data-lazy-src"] || a["data-original"] || a["src"], alt);
  });
  $("picture source[srcset], source[data-srcset]").each((_, el) => {
    const s = $(el).attr("srcset") ?? $(el).attr("data-srcset");
    if (s) addImg(bestFromSrcset(s) ?? undefined, null);
  });
  $("[style*='background']").each((_, el) => {
    const m = ($(el).attr("style") ?? "").match(/url\((['"]?)([^'")]+)\1\)/);
    if (m) addImg(m[2], null);
  });
  $("video[src], video source[src]").each((_, el) => addVid($(el).attr("src")));
  $("iframe[src]").each((_, el) => {
    const s = $(el).attr("src") ?? "";
    if (/youtube|vimeo/i.test(s)) addVid(s);
  });
  $('a[href*="youtube.com/watch"], a[href*="youtu.be/"]').each((_, el) => addVid($(el).attr("href")));

  $("script, style, svg, noscript, nav, footer, iframe, form, template").remove();
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, dt, dd").each((_, el) => {
    $(el).append("\n");
  });
  const texto = $("body")
    .text()
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, maxChars);

  const head = [...meta, ...(ld.length ? ["JSON-LD:", ...ld] : [])].join("\n");
  return { texto: `${head}\n\n${texto}`.trim().slice(0, maxChars + 12_000), imagenes, videos };
}
