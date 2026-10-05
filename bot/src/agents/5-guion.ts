import fs from "node:fs/promises";
import path from "node:path";
import { analisisVideoSchema, correccionSchema, editPlanSchema, planLlmSchema, type AnalisisVideo, type EditPlan, type PlanLlm } from "../schemas/plan.js";
import { propiedadSchema } from "../schemas/propiedad.js";
import { aplicarCorrecciones, aSrt, paginas, textoPlano, type Transcripcion } from "../lib/transcripcion.js";
import { extractAudio16k, extractFrames, normalizeVideo, probe, sceneCuts } from "../lib/ffmpeg.js";
import { exists, hashFiles, readJson, statHash, writeJson } from "../lib/hash.js";
import { loadCliente } from "../project/cliente.js";
import { skillPrompt } from "../skills.js";
import { AgentError, runAgent, type AgentContext, type AgentResult } from "./context.js";
import { repararPlan, resumenPlan } from "./plan.js";
import { leerEstado } from "./4-extender.js";

const VIDEO_RE = /^original\.(mp4|mov|mkv|webm|m4v|avi)$/i;

export async function videoOriginal(ctx: Pick<AgentContext, "paths" | "cliente" | "slug">): Promise<string | null> {
  const dir = ctx.paths.subdir(ctx.cliente, ctx.slug, "videoGrabado");
  const f = (await fs.readdir(dir).catch(() => [] as string[])).find((n) => VIDEO_RE.test(n));
  return f ? path.join(dir, f) : null;
}

export async function guion(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const original = await videoOriginal(ctx);
  if (!original) throw new AgentError("No hay video grabado. Mandalo con /subir (como archivo/documento) y volvé a ejecutar /guion.");
  const dirGuion = paths.subdir(cliente, slug, "guion");
  const cambios = typeof ctx.args["cambios"] === "string" ? (ctx.args["cambios"] as string) : "";
  const propFile = paths.file(cliente, slug, "datos", "propiedad.json");

  return runAgent(
    ctx,
    "guion",
    {
      hashEntrada: cambios ? undefined : `${await statHash([original])}:${await hashFiles([propFile])}:${ctx.args["voz"] ? "vo" : ""}`,
      salidas: () => ["05_guion/edit-plan.json", "05_guion/guion.md", "05_guion/subtitulos.srt"],
    },
    async () => {
      await fs.mkdir(dirGuion, { recursive: true });
      const trabajo = path.join(paths.subdir(cliente, slug, "videoGrabado"), "trabajo.mp4");
      const transFile = path.join(dirGuion, "transcripcion.json");
      const analisisFile = path.join(dirGuion, "analisis.json");

      // ---- A/B/C/D (se saltean si solo se piden cambios al plan y ya existen)
      let transcripcion: Transcripcion;
      let analisis: AnalisisVideo;
      if (cambios && (await exists(transFile)) && (await exists(analisisFile)) && (await exists(trabajo))) {
        transcripcion = await readJson<Transcripcion>(transFile);
        analisis = analisisVideoSchema.parse(await readJson(analisisFile));
      } else {
        ctx.progress("🎞 Normalizando el video…");
        await normalizeVideo(original, trabajo, 30, ctx.signal);
        const info0 = await probe(trabajo);
        transcripcion = await transcribir(ctx, trabajo, info0.tieneAudio, dirGuion);
        ctx.progress("🎞 Analizando escenas…");
        analisis = await analizarVideo(ctx, trabajo, info0.duracion_s);
        await writeJson(analisisFile, analisis);
      }
      const info = await probe(trabajo);

      // ---- E: plan
      ctx.progress("🧠 Armando el plan de edición…");
      const prop = propiedadSchema.parse(await readJson(propFile));
      const cli = await loadCliente(paths, cliente);
      const est = await leerEstado(ctx);
      const dirPrompts = paths.subdir(cliente, slug, "prompts");
      const imagenes: { archivo: string; ambiente: string; descripcion: string }[] = [];
      for (const n of Object.keys(est).sort()) {
        const p = await readJson<{ tipo_ambiente: string; descripcion_corta: string }>(path.join(dirPrompts, `${n}.json`)).catch(() => null);
        imagenes.push({ archivo: `${n}.png`, ambiente: p?.tipo_ambiente ?? "?", descripcion: p?.descripcion_corta ?? "" });
      }
      const extensionFinal = 2.5;
      const planFile = path.join(dirGuion, "edit-plan.json");
      const previo = cambios && (await exists(planFile)) ? await readJson(planFile) : null;
      const lineas = paginas(transcripcion.palabras, 3, 8).map((pg) => `[${(pg[0]!.inicio_ms / 1000).toFixed(1)}s] ${pg.map((w) => w.texto).join(" ")}`);

      await ctx.assertBudget();
      const { data, costUsd } = await ctx.llm.json({
        model: ctx.config.MODEL_TEXT,
        system: skillPrompt("guion", "plan"),
        user: [
          `DURACIÓN DEL VIDEO: ${info.duracion_s.toFixed(1)} s (la tarjeta final puede extenderse ${extensionFinal} s más)`,
          `VOZ EN OFF: ${ctx.args["voz"] ? "SÍ, generá segmentos vo" : "NO (vo vacío)"}`,
          `CLIENTE: ${cli.nombre} · tono: ${cli.tono} · idioma: ${cli.idioma} · CTA: ${cli.cta_por_defecto} · contacto: ${JSON.stringify(cli.contacto)}`,
          `PROPIEDAD: ${JSON.stringify({ titulo: prop.titulo, tipo: prop.tipo_propiedad, operacion: prop.tipo_operacion, precio: prop.precio, ubicacion: prop.ubicacion, superficie: prop.superficie, ambientes: prop.ambientes, dormitorios: prop.dormitorios, banos: prop.banos, amenities: prop.amenities, caracteristicas: prop.caracteristicas })}`,
          `TRANSCRIPCIÓN:\n${lineas.join("\n") || "(sin voz)"}`,
          `ANÁLISIS DE ESCENAS: ${JSON.stringify(analisis.segmentos)}`,
          `IMÁGENES DISPONIBLES PARA INSERTS (usá estos nombres exactos): ${JSON.stringify(imagenes)}`,
          previo ? `PLAN ANTERIOR: ${JSON.stringify(previo)}\nCAMBIOS PEDIDOS POR EL USUARIO: ${cambios}\nAplicá SOLO esos cambios y conservá el resto igual.` : "",
        ].filter(Boolean).join("\n\n"),
        name: "plan_edicion",
        schema: planLlmSchema,
        signal: ctx.signal,
        mock: () => mockPlan(info.duracion_s, imagenes.map((i) => i.archivo), prop.amenities, prop.titulo ?? slug, !!ctx.args["voz"]),
      });
      ctx.spend(costUsd);

      const musicaDir = path.join(paths.plantillaDir, "musica");
      const musica = (await fs.readdir(musicaDir).catch(() => [] as string[])).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort()[0] ?? null;
      const bruto: EditPlan = editPlanSchema.parse({
        version: 1,
        video: { archivo: "02_media/video_grabado/trabajo.mp4", duracion_s: info.duracion_s, fps: 30, ancho: info.ancho, alto: info.alto },
        salida: { ancho: 1080, alto: 1920, fps: 30, extension_final_s: extensionFinal },
        captions: { fuente: "05_guion/transcripcion.json", grupo_palabras: [2, 4] },
        overlays: data.overlays,
        inserts: data.inserts,
        vo: data.vo.map((v) => ({ ...v, archivo: null, duracion_s: null })),
        musica: { archivo: musica ? `plantilla/musica/${musica}` : null, volumen: data.musica_volumen, ducking: true },
        guion: data.guion,
      });
      const { plan, avisos } = repararPlan(bruto, { duracion: info.duracion_s, extensionFinal, imagenes: new Set(imagenes.map((i) => i.archivo)) });
      await writeJson(planFile, plan);
      await fs.writeFile(path.join(dirGuion, "guion.md"), `# Guion — ${prop.titulo ?? slug}\n\n${plan.guion}\n\n## Línea de tiempo\n\n\`\`\`\n${resumenPlan(plan)}\n\`\`\`\n`);

      const palabras = transcripcion.palabras.length;
      const texto = [
        `✅ Plan de edición listo (${info.duracion_s.toFixed(0)} s, ${palabras} palabras transcriptas)`,
        "",
        resumenPlan(plan),
        avisos.length ? `\n⚠️ Ajustes automáticos:\n${avisos.map((a) => `• ${a}`).join("\n")}` : "",
        `\n📝 Subtítulos: ${textoPlano(transcripcion.palabras).slice(0, 400)}${palabras > 60 ? "…" : ""}`,
      ].join("\n");
      return {
        texto,
        botones: [
          [{ texto: "✅ Aprobar plan y generar video", data: "next:video" }],
          [{ texto: "✏️ Pedir cambios", data: "pl:cambios" }, { texto: "📝 Corregir subtítulos", data: "st:edit" }],
          ...(plan.vo.length ? [[{ texto: "🎙 Generar voz en off", data: "next:voz" }]] : []),
        ],
      };
    },
  );
}

async function transcribir(ctx: AgentContext, trabajo: string, tieneAudio: boolean, dir: string): Promise<Transcripcion> {
  const { paths, cliente, slug } = ctx;
  if (!tieneAudio) {
    const vacio = { idioma: "es", palabras: [] };
    await writeJson(path.join(dir, "transcripcion.json"), vacio);
    await fs.writeFile(path.join(dir, "subtitulos.srt"), "");
    return vacio;
  }
  ctx.progress("🎧 Transcribiendo (puede tardar unos minutos)…");
  const wav = path.join(dir, "audio16k.wav");
  await extractAudio16k(trabajo, wav, ctx.signal);
  const cli = await loadCliente(paths, cliente);
  const bruta = await ctx.transcriber.transcribe(wav, {
    idioma: cli.idioma,
    modelo: ctx.config.WHISPER_MODEL,
    dir: path.join(paths.root, "whisper"),
    signal: ctx.signal,
    onProgress: (p) => ctx.progress(`🎧 Transcribiendo… ${Math.round(p * 100)}%`),
  });
  await writeJson(path.join(dir, "transcripcion_original.json"), bruta);
  await fs.rm(wav, { force: true });

  // Corrección de nombres propios con glosario (no cambia cantidad de palabras ni tiempos).
  let t = bruta;
  if (bruta.palabras.length) {
    const prop = propiedadSchema.parse(await readJson(paths.file(cliente, slug, "datos", "propiedad.json")));
    const glosario = [...new Set([cli.nombre, prop.titulo, prop.ubicacion.barrio, prop.ubicacion.ciudad, prop.ubicacion.direccion, prop.ubicacion.provincia, ...prop.amenities, ...prop.caracteristicas].filter((x): x is string => !!x))];
    await ctx.assertBudget();
    const { data, costUsd } = await ctx.llm.json({
      model: ctx.config.MODEL_TEXT,
      system: skillPrompt("guion", "corregir"),
      user: `GLOSARIO: ${glosario.join(" | ")}\n\nPALABRAS:\n${bruta.palabras.map((w, i) => `[${i}] ${w.texto}`).join("\n")}`,
      name: "correcciones",
      schema: correccionSchema,
      signal: ctx.signal,
      mock: () => ({ correcciones: [] }),
    });
    ctx.spend(costUsd);
    t = { ...bruta, palabras: aplicarCorrecciones(bruta.palabras, data.correcciones) };
  }
  await writeJson(path.join(dir, "transcripcion.json"), t);
  await fs.writeFile(path.join(dir, "subtitulos.srt"), aSrt(t.palabras));
  return t;
}

/** Cortes + un frame por segundo (cada 2 s si el video es largo) → segmentos con visión, en lotes. */
async function analizarVideo(ctx: AgentContext, trabajo: string, duracion: number): Promise<AnalisisVideo> {
  const dirFrames = path.join(ctx.paths.subdir(ctx.cliente, ctx.slug, "guion"), "_frames");
  try {
    const cortes = await sceneCuts(trabajo, 0.3, ctx.signal);
    const frames = await extractFrames(trabajo, dirFrames, { everySec: duracion > 90 ? 2 : 1, extraTimes: cortes, width: 512, signal: ctx.signal });
    const lote = 12;
    const segmentos: AnalisisVideo["segmentos"] = [];
    for (let i = 0; i < frames.length; i += lote) {
      const grupo = frames.slice(i, i + lote);
      const user = grupo.flatMap((f) => [
        { type: "text" as const, text: `t=${f.t.toFixed(1)}s` },
        { type: "image" as const, base64: "", mime: "image/jpeg" },
      ]);
      for (let k = 0; k < grupo.length; k++) (user[k * 2 + 1] as { base64: string }).base64 = (await fs.readFile(grupo[k]!.file)).toString("base64");
      const tIni = grupo[0]!.t;
      const tFin = Math.min(duracion, (grupo[grupo.length - 1]!.t ?? tIni) + (duracion > 90 ? 2 : 1));
      await ctx.assertBudget();
      const { data, costUsd } = await ctx.llm.json({
        model: ctx.config.MODEL_VISION,
        system: skillPrompt("guion", "analizar"),
        user: [{ type: "text", text: `Fotogramas de ${tIni.toFixed(1)} s a ${tFin.toFixed(1)} s (cortes detectados en: ${cortes.map((c) => c.toFixed(1)).join(", ") || "ninguno"}).` }, ...user],
        name: "analisis_video",
        schema: analisisVideoSchema,
        signal: ctx.signal,
        mock: () => ({ segmentos: [{ inicio: tIni, fin: tFin, que_se_ve: "toma de la propiedad (mock)", ambiente: null, habla_presentador: false, zona_libre: "arriba" as const }] }),
      });
      ctx.spend(costUsd);
      segmentos.push(...data.segmentos.map((s) => ({ ...s, inicio: Math.max(0, s.inicio), fin: Math.min(duracion, Math.max(s.fin, s.inicio)) })));
    }
    return { segmentos: segmentos.sort((a, b) => a.inicio - b.inicio) };
  } finally {
    await fs.rm(dirFrames, { recursive: true, force: true });
  }
}

function mockPlan(duracion: number, imagenes: string[], amenities: string[], titulo: string, voz: boolean): PlanLlm {
  const overlays: PlanLlm["overlays"] = [
    { id: "t1", tipo: "titulo", inicio: 0.2, fin: Math.min(2.7, duracion), texto: titulo.slice(0, 28), subtexto: "BARRIO PRIVADO", icono: null, posicion: "abajo_izq" },
    { id: "prog", tipo: "barra_progreso", inicio: 0, fin: duracion, texto: null, subtexto: null, icono: null, posicion: "arriba_centro" },
  ];
  amenities.slice(0, 3).forEach((a, i) => {
    const ini = 3 + i * 2;
    if (ini + 1.5 < duracion) overlays.push({ id: `c${i}`, tipo: "chip_amenity", inicio: ini, fin: ini + 1.5, texto: a.slice(0, 24), subtexto: null, icono: null, posicion: "arriba_der" });
  });
  const inserts: PlanLlm["inserts"] = imagenes.slice(0, 2).map((img, i) => ({ id: `i${i}`, imagen: img, inicio: 4 + i * 3, fin: 6 + i * 3, modo: "pantalla_completa" as const, movimiento: "zoom_in" as const })).filter((i) => i.fin < duracion);
  return { guion: "Recorrido de la propiedad (mock).", overlays, inserts, vo: voz ? [{ id: "vo1", texto: "Conocé esta increíble propiedad.", inicio: 0.5 }] : [], musica_volumen: 0.12 };
}
