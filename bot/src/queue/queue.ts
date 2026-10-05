import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type JobClass = "heavy" | "light";
export type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface Job {
  id: number;
  tipo: string;
  clase: JobClass;
  cliente: string | null;
  proyecto: string | null;
  chat_id: number | null;
  estado: JobState;
  payload: Record<string, unknown>;
  error: string | null;
  creado: string;
  iniciado: string | null;
  terminado: string | null;
}

interface Row extends Omit<Job, "payload"> {
  payload: string;
}
const toJob = (r: Row): Job => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> });

export class JobStore {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        clase TEXT NOT NULL DEFAULT 'light',
        cliente TEXT, proyecto TEXT, chat_id INTEGER,
        estado TEXT NOT NULL DEFAULT 'queued',
        payload TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        creado TEXT NOT NULL, iniciado TEXT, terminado TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_estado ON jobs(estado);
      CREATE TABLE IF NOT EXISTS chat_state (
        chat_id INTEGER PRIMARY KEY,
        cliente TEXT, proyecto TEXT
      );
      CREATE TABLE IF NOT EXISTS gastos (dia TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pending (
        chat_id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}'
      );
    `);
  }

  enqueue(j: {
    tipo: string;
    clase?: JobClass;
    cliente?: string | null;
    proyecto?: string | null;
    chatId?: number | null;
    payload?: Record<string, unknown>;
  }): Job {
    const r = this.db
      .prepare(
        `INSERT INTO jobs (tipo, clase, cliente, proyecto, chat_id, payload, creado)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        j.tipo,
        j.clase ?? "light",
        j.cliente ?? null,
        j.proyecto ?? null,
        j.chatId ?? null,
        JSON.stringify(j.payload ?? {}),
        new Date().toISOString(),
      );
    return this.get(Number(r.lastInsertRowid))!;
  }

  get(id: number): Job | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return r && toJob(r);
  }

  list(estados: JobState[], limit = 20): Job[] {
    const q = estados.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE estado IN (${q}) ORDER BY id DESC LIMIT ?`)
      .all(...estados, limit) as Row[];
    return rows.map(toJob);
  }

  countRunning(clase: JobClass): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM jobs WHERE estado='running' AND clase=?")
      .get(clase) as { n: number };
    return r.n;
  }

  /** Toma atómicamente el próximo job en cola de la clase dada y lo marca "running". */
  claimNext(clase: JobClass): Job | undefined {
    const tx = this.db.transaction(() => {
      const r = this.db
        .prepare("SELECT * FROM jobs WHERE estado='queued' AND clase=? ORDER BY id LIMIT 1")
        .get(clase) as Row | undefined;
      if (!r) return undefined;
      this.db.prepare("UPDATE jobs SET estado='running', iniciado=? WHERE id=?").run(new Date().toISOString(), r.id);
      return this.get(r.id);
    });
    return tx();
  }

  finish(id: number, estado: "done" | "error" | "cancelled", error?: string): void {
    this.db
      .prepare("UPDATE jobs SET estado=?, error=?, terminado=? WHERE id=? AND estado IN ('running','queued')")
      .run(estado, error ?? null, new Date().toISOString(), id);
  }

  /** Al arrancar: todo lo que quedó "running" pasa a error. Devuelve los jobs afectados. */
  recoverOnStart(): Job[] {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE estado='running'").all() as Row[];
    this.db
      .prepare("UPDATE jobs SET estado='error', error='reinicio', terminado=? WHERE estado='running'")
      .run(new Date().toISOString());
    return rows.map(toJob);
  }

  getChatState(chatId: number): { cliente: string | null; proyecto: string | null } {
    const r = this.db.prepare("SELECT cliente, proyecto FROM chat_state WHERE chat_id=?").get(chatId) as
      | { cliente: string | null; proyecto: string | null }
      | undefined;
    return r ?? { cliente: null, proyecto: null };
  }

  setChatState(chatId: number, s: { cliente?: string | null; proyecto?: string | null }): void {
    const cur = this.getChatState(chatId);
    const next = { cliente: s.cliente !== undefined ? s.cliente : cur.cliente, proyecto: s.proyecto !== undefined ? s.proyecto : cur.proyecto };
    this.db
      .prepare(
        `INSERT INTO chat_state (chat_id, cliente, proyecto) VALUES (?,?,?)
         ON CONFLICT(chat_id) DO UPDATE SET cliente=excluded.cliente, proyecto=excluded.proyecto`,
      )
      .run(chatId, next.cliente, next.proyecto);
  }

  /** Gasto diario acumulado (USD, día UTC) para el tope MAX_USD_PER_DAY. */
  addSpend(usd: number, now = new Date()): void {
    const dia = now.toISOString().slice(0, 10);
    this.db
      .prepare("INSERT INTO gastos (dia, usd) VALUES (?, ?) ON CONFLICT(dia) DO UPDATE SET usd = usd + excluded.usd")
      .run(dia, usd);
  }

  spentToday(now = new Date()): number {
    const r = this.db.prepare("SELECT usd FROM gastos WHERE dia=?").get(now.toISOString().slice(0, 10)) as { usd: number } | undefined;
    return r?.usd ?? 0;
  }

  /** Acción que espera la próxima respuesta de texto del usuario (editar prompt, cambios al plan…). */
  setPending(chatId: number, tipo: string, data: Record<string, unknown> = {}): void {
    this.db
      .prepare("INSERT INTO pending (chat_id, tipo, data) VALUES (?,?,?) ON CONFLICT(chat_id) DO UPDATE SET tipo=excluded.tipo, data=excluded.data")
      .run(chatId, tipo, JSON.stringify(data));
  }

  getPending(chatId: number): { tipo: string; data: Record<string, unknown> } | undefined {
    const r = this.db.prepare("SELECT tipo, data FROM pending WHERE chat_id=?").get(chatId) as { tipo: string; data: string } | undefined;
    return r && { tipo: r.tipo, data: JSON.parse(r.data) as Record<string, unknown> };
  }

  clearPending(chatId: number): void {
    this.db.prepare("DELETE FROM pending WHERE chat_id=?").run(chatId);
  }

  close(): void {
    this.db.close();
  }
}

export type JobHandler = (job: Job, ctx: { signal: AbortSignal }) => Promise<void>;

export interface WorkerEvents {
  onStart?: (job: Job) => void | Promise<void>;
  onDone?: (job: Job) => void | Promise<void>;
  onError?: (job: Job, error: string) => void | Promise<void>;
}

/** Worker en proceso: concurrencia 1 para "heavy" y 3 para "light" (configurable). */
export class Worker {
  private handlers = new Map<string, JobHandler>();
  private controllers = new Map<number, AbortController>();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private store: JobStore,
    private events: WorkerEvents = {},
    private limits: Record<JobClass, number> = { heavy: 1, light: 3 },
  ) {}

  register(tipo: string, handler: JobHandler): void {
    this.handlers.set(tipo, handler);
  }

  start(intervalMs = 500): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.controllers.values()) c.abort();
  }

  /** Cancela un job en cola o en ejecución. */
  cancel(id: number): boolean {
    const c = this.controllers.get(id);
    if (c) {
      c.abort();
      return true;
    }
    const j = this.store.get(id);
    if (j?.estado === "queued") {
      this.store.finish(id, "cancelled");
      return true;
    }
    return false;
  }

  cancelAllFor(chatId: number): number {
    let n = 0;
    for (const j of this.store.list(["queued", "running"], 100)) if (j.chat_id === chatId && this.cancel(j.id)) n++;
    return n;
  }

  /** Procesa lo que haya disponible (también se usa directamente en tests). */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const clase of ["heavy", "light"] as const) {
        while (this.store.countRunning(clase) < this.limits[clase]) {
          const job = this.store.claimNext(clase);
          if (!job) break;
          void this.run(job);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async idle(): Promise<void> {
    while (this.controllers.size > 0) await new Promise((r) => setTimeout(r, 10));
  }

  private async run(job: Job): Promise<void> {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    try {
      await this.events.onStart?.(job);
      const handler = this.handlers.get(job.tipo);
      if (!handler) throw new Error(`Agente no implementado: ${job.tipo}`);
      await handler(job, { signal: ctrl.signal });
      if (ctrl.signal.aborted) {
        this.store.finish(job.id, "cancelled");
      } else {
        this.store.finish(job.id, "done");
        await this.events.onDone?.(job);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ctrl.signal.aborted) this.store.finish(job.id, "cancelled");
      else {
        this.store.finish(job.id, "error", msg);
        await this.events.onError?.(job, msg);
      }
    } finally {
      this.controllers.delete(job.id);
    }
  }
}
