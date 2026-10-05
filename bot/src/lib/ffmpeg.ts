import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Ejecuta un binario; si `signal` se aborta, mata el proceso hijo. */
export function run(cmd: string, args: string[], o: { signal?: AbortSignal; onStderr?: (s: string) => void; onStdout?: (s: string) => void; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal: o.signal, cwd: o.cwd, env: o.env ?? process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      o.onStdout?.(String(d));
    });
    child.stderr.on("data", (d) => {
      const s = String(d);
      stderr += s;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
      o.onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} terminó con código ${code}: ${stderr.slice(-600)}`)),
    );
  });
}

export interface VideoInfo {
  duracion_s: number;
  ancho: number;
  alto: number;
  fps: number;
  rotacion: number;
  tieneAudio: boolean;
}

export async function probe(file: string): Promise<VideoInfo> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error("El archivo no contiene video");
  const [n, d] = (v.avg_frame_rate ?? "30/1").split("/").map(Number) as [number, number];
  const rot = Math.abs(Number(v.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 360;
  const swap = rot === 90 || rot === 270;
  return {
    duracion_s: Number(j.format?.duration ?? v.duration ?? 0),
    ancho: swap ? v.height : v.width,
    alto: swap ? v.width : v.height,
    fps: d ? n / d : 30,
    rotacion: rot,
    tieneAudio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

/** CFR 30 fps, yuv420p, audio 48 kHz; aplica la rotación (ffmpeg autorota por defecto). */
export async function normalizeVideo(input: string, output: string, fps = 30, signal?: AbortSignal): Promise<void> {
  await run(
    "ffmpeg",
    ["-y", "-i", input, "-vf", `fps=${fps},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output],
    { signal },
  );
}

export const extractAudio16k = (input: string, output: string, signal?: AbortSignal) =>
  run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output], { signal });

/** Instantes (s) de corte de escena. */
export async function sceneCuts(input: string, threshold = 0.3, signal?: AbortSignal): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-i", input, "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"], { signal });
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
}

/** Extrae frames cada `everySec` segundos; devuelve [{t, file}]. */
export async function extractFrames(
  input: string,
  outDir: string,
  o: { everySec?: number; width?: number; extraTimes?: number[]; signal?: AbortSignal } = {},
): Promise<{ t: number; file: string }[]> {
  await fs.mkdir(outDir, { recursive: true });
  const every = o.everySec ?? 1;
  const width = o.width ?? 512;
  const info = await probe(input);
  const times = new Set<number>();
  const ultimo = Math.max(0, info.duracion_s - 0.15); // un ss al final exacto no produce fotograma
  for (let t = 0; t <= ultimo; t += every) times.add(Number(t.toFixed(2)));
  for (const t of o.extraTimes ?? []) if (t <= ultimo) times.add(Number(t.toFixed(2)));
  const sorted = [...times].sort((a, b) => a - b);
  const out: { t: number; file: string }[] = [];
  for (const t of sorted) {
    const file = path.join(outDir, `f_${String(Math.round(t * 100)).padStart(6, "0")}.jpg`);
    await run("ffmpeg", ["-y", "-ss", String(t), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", file], { signal: o.signal });
    if (await fs.stat(file).then(() => true, () => false)) out.push({ t, file });
  }
  return out;
}

/** PCM s16le 24 kHz mono → WAV con loudnorm a -16 LUFS. */
export async function pcmToWav(pcmFile: string, wavFile: string, o: { rate?: number; normalize?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  const args = ["-y", "-f", "s16le", "-ar", String(o.rate ?? 24000), "-ac", "1", "-i", pcmFile];
  if (o.normalize !== false) args.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  args.push(wavFile);
  await run("ffmpeg", args, { signal: o.signal });
}

export async function duracionAudio(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim());
}
