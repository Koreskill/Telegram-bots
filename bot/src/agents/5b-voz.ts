import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { editPlanSchema, type EditPlan } from "../schemas/plan.js";
import { duracionAudio, pcmToWav } from "../lib/ffmpeg.js";
import { exists, readJson, writeJson, hashFiles } from "../lib/hash.js";
import { loadCliente } from "../project/cliente.js";
import { skillPrompt } from "../skills.js";
import { AgentError, runAgent, type AgentContext, type AgentResult } from "./context.js";

export async function voz(ctx: AgentContext): Promise<AgentResult> {
  const { paths, cliente, slug } = ctx;
  const planFile = path.join(paths.subdir(cliente, slug, "guion"), "edit-plan.json");
  if (!(await exists(planFile))) throw new AgentError("Primero ejecutá /guion.");
  const solo = ctx.args["solo"] as string | undefined;
  const textoNuevo = typeof ctx.args["texto"] === "string" ? (ctx.args["texto"] as string) : undefined;
  const plan0 = editPlanSchema.parse(await readJson(planFile));
  if (plan0.vo.length === 0) throw new AgentError("El plan no tiene segmentos de voz en off. Pedí cambios al plan o corré /guion --voz.");

  return runAgent(
    ctx,
    "voz",
    { hashEntrada: solo ? undefined : await hashFiles([planFile]), salidas: () => plan0.vo.map((_, i) => `05_guion/voz/vo_${String(i + 1).padStart(3, "0")}.wav`) },
    async () => {
      const cli = await loadCliente(paths, cliente);
      const plan: EditPlan = structuredClone(plan0);
      const dir = paths.subdir(cliente, slug, "voz");
      await fs.mkdir(dir, { recursive: true });
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "voz-"));
      const voice = cli.voz.voice ?? ctx.config.TTS_VOICE;
      const instrucciones = skillPrompt("voz", "sistema", { idioma: cli.idioma, tono: cli.tono, instrucciones: cli.voz.instrucciones });
      const media: NonNullable<AgentResult["media"]> = [];
      try {
        for (const [i, v] of plan.vo.entries()) {
          if (solo && v.id !== solo) continue;
          if (solo && textoNuevo) v.texto = textoNuevo;
          ctx.progress(`🎙 Generando voz ${i + 1}/${plan.vo.length}`);
          await ctx.assertBudget();
          const r = await ctx.llm.speech({ model: ctx.config.MODEL_TTS, voice, text: v.texto, instructions: instrucciones, signal: ctx.signal });
          ctx.spend(r.costUsd);
          const pcm = path.join(tmp, `${v.id}.pcm`);
          await fs.writeFile(pcm, r.pcm);
          const nombre = `vo_${String(i + 1).padStart(3, "0")}.wav`;
          const wav = path.join(dir, nombre);
          await pcmToWav(pcm, wav, { signal: ctx.signal });
          v.archivo = `05_guion/voz/${nombre}`;
          v.duracion_s = Number((await duracionAudio(wav)).toFixed(2));
          media.push({ path: wav, tipo: "audio", caption: `${v.id}: ${v.texto.slice(0, 80)}`, botones: [[{ texto: "🔁 Regenerar", data: `vr:${v.id}` }]] });
        }
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
      await writeJson(planFile, editPlanSchema.parse(plan));
      return {
        texto: `✅ ${media.length} clip(s) de voz generados y normalizados a -16 LUFS. Escuchalos y seguí con el video.`,
        media,
        botones: [[{ texto: "🎬 Generar video (/video)", data: "next:video" }]],
      };
    },
  );
}
