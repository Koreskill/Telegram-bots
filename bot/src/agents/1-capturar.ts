import fs from "node:fs/promises";
import { propiedadLlmSchema, propiedadSchema, camposFaltantes, type Propiedad } from "../schemas/propiedad.js";
import { reducirHtml } from "../lib/html.js";
import { writeJson } from "../lib/hash.js";
import { loadCliente, slugUnico } from "../project/cliente.js";
import { createProject, updateManifest } from "../project/manifest.js";
import { slugify } from "../paths.js";
import { skillPrompt } from "../skills.js";
import { assertPublicUrl } from "../lib/net.js";
import { AgentError, type AgentContext, type AgentResult } from "./context.js";
import { BudgetError } from "./context.js";

const MAX_CANDIDATAS = 150;

export interface CapturarArgs {
  url: string;
}

/**
 * Agente 1. A diferencia de los demás, CREA el proyecto: por eso no usa runAgent con un slug previo.
 * Devuelve el slug nuevo en `resultado.slug`.
 */
export async function capturar(
  ctx: Omit<AgentContext, "slug"> & { slug?: string },
  url: string,
): Promise<AgentResult & { slug: string }> {
  await assertPublicUrl(url); // falla rápido (anti-SSRF) antes de abrir el navegador
  ctx.progress("🌐 Abriendo la página…");
  const pagina = await ctx.fetcher.fetch(url, { signal: ctx.signal });
  ctx.progress("🧹 Extrayendo contenido…");
  const red = reducirHtml(pagina.html, pagina.finalUrl);
  if (red.texto.length < 80) throw new AgentError("La página no tiene contenido legible (¿requiere login o bloquea bots?).");

  const candidatas = red.imagenes.slice(0, MAX_CANDIDATAS);
  const listado = candidatas.map((c, i) => `[IMG#${i}] ${c.url}${c.alt ? ` | alt: ${c.alt}` : ""}`).join("\n");

  await ctx.assertBudget();
  ctx.progress("🤖 Analizando con IA…");
  const { data, costUsd } = await ctx.llm.json({
    model: ctx.config.MODEL_EXTRACT,
    system: skillPrompt("capturar"),
    user: `URL: ${pagina.finalUrl}\n\n=== CONTENIDO ===\n${red.texto}\n\n=== IMÁGENES CANDIDATAS ===\n${listado || "(ninguna)"}`,
    name: "propiedad",
    schema: propiedadLlmSchema,
    signal: ctx.signal,
    mock: () => mockPropiedad(candidatas.length),
  });
  ctx.spend(costUsd);

  // Imágenes: las que indicó el modelo (índices válidos y únicos); si no indicó ninguna, todas las candidatas.
  const idx = [...new Set(data.indices_imagenes)].filter((i) => i >= 0 && i < candidatas.length);
  const imagenes = (idx.length ? idx.map((i) => candidatas[i]!) : candidatas).map((c) => ({ url: c.url, alt: c.alt }));

  const { indices_imagenes: _omit, ...resto } = data;
  const propiedad: Propiedad = propiedadSchema.parse({
    ...resto,
    url_fuente: pagina.finalUrl,
    imagenes,
    videos: red.videos,
    campos_faltantes: camposFaltantes(data),
    capturado: new Date().toISOString(),
  });

  const cliente = ctx.cliente;
  const base = [propiedad.ubicacion.barrio ?? propiedad.ubicacion.ciudad, propiedad.tipo_propiedad, propiedad.titulo].filter(Boolean).join(" ") || new URL(pagina.finalUrl).hostname;
  const slug = await slugUnico(ctx.paths, cliente, slugify(base));
  await createProject(ctx.paths, cliente, slug, pagina.finalUrl);

  await writeJson(ctx.paths.file(cliente, slug, "datos", "propiedad.json"), propiedad);
  await fs.writeFile(ctx.paths.file(cliente, slug, "datos", "pagina.html"), pagina.html);
  if (pagina.screenshot) await fs.writeFile(ctx.paths.file(cliente, slug, "datos", "captura.jpg"), pagina.screenshot);

  await updateManifest(ctx.paths, cliente, slug, (m) => {
    m.auto = ctx.args["auto"] === true;
    m.agentes.capturar = {
      ...m.agentes.capturar,
      estado: "done",
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      salidas: ["01_datos/propiedad.json", "01_datos/pagina.html", ...(pagina.screenshot ? ["01_datos/captura.jpg"] : [])],
      costo_usd: costUsd,
    };
  });

  const c = await loadCliente(ctx.paths, cliente);
  const precio = propiedad.precio.monto != null ? `${propiedad.precio.moneda ?? ""} ${propiedad.precio.monto.toLocaleString("es-AR")}`.trim() : "—";
  const sup = propiedad.superficie.total_m2 ?? propiedad.superficie.cubierta_m2 ?? propiedad.superficie.terreno_m2;
  const lineas = [
    `✅ Proyecto creado: ${c.nombre} / ${slug}`,
    `📍 ${[propiedad.ubicacion.barrio, propiedad.ubicacion.ciudad].filter(Boolean).join(", ") || "ubicación no encontrada"}`,
    `💲 ${precio} · ${sup ?? "—"} m² · ${propiedad.ambientes ?? "—"} amb · ${propiedad.dormitorios ?? "—"} dorm`,
    `🖼 ${propiedad.imagenes.length} imágenes · 🎬 ${propiedad.videos.length} videos (vía ${pagina.via})`,
  ];
  if (propiedad.campos_faltantes.length) lineas.push(`⚠️ Faltan: ${propiedad.campos_faltantes.join(", ")}`);
  return {
    slug,
    texto: lineas.join("\n"),
    botones: [[{ texto: "➡️ Descargar imágenes (/imagenes)", data: "next:imagenes" }]],
  };
}

function mockPropiedad(n: number) {
  return {
    titulo: "Casa en barrio privado",
    tipo_operacion: "venta" as const,
    tipo_propiedad: "casa",
    precio: { monto: 250000, moneda: "USD" as const },
    expensas: null,
    ubicacion: { direccion: null, barrio: "Finca Dos", ciudad: "Córdoba", provincia: "Córdoba", pais: "Argentina" },
    superficie: { total_m2: 800, cubierta_m2: 180, terreno_m2: 800 },
    ambientes: 5,
    dormitorios: 3,
    banos: 2,
    cocheras: 2,
    antiguedad: null,
    amenities: ["laguna", "canchas de pádel", "pileta"],
    caracteristicas: ["quincho"],
    descripcion: "Casa moderna en barrio privado con amenities.",
    contacto: { nombre: null, telefono: null, email: null },
    indices_imagenes: Array.from({ length: n }, (_, i) => i),
  };
}

export { BudgetError };
