import type { EditPlan, Insert, Overlay } from "../schemas/plan.js";

export interface PlanCtx {
  duracion: number;
  extensionFinal: number;
  imagenes: Set<string>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reglas de coherencia del plan de edición (determinista, no depende del LLM):
 * tiempos dentro de rango, 1 solo chip a la vez, inserts sin solaparse y acotados,
 * imágenes existentes, tarjeta final garantizada. Devuelve el plan reparado y los avisos.
 */
export function repararPlan(plan: EditPlan, c: PlanCtx): { plan: EditPlan; avisos: string[] } {
  const avisos: string[] = [];
  const total = c.duracion + c.extensionFinal;
  const clamp = (n: number) => r2(Math.min(Math.max(n, 0), total));

  // --- overlays
  let overlays: Overlay[] = [];
  for (const o of plan.overlays) {
    const inicio = clamp(o.inicio);
    let fin = clamp(o.fin);
    if (o.tipo === "barra_progreso") {
      overlays.push({ ...o, inicio: 0, fin: total });
      continue;
    }
    if (fin - inicio < 0.8) fin = clamp(inicio + 0.8);
    if (fin - inicio < 0.5) {
      avisos.push(`Overlay ${o.id} descartado (fuera de rango o muy corto)`);
      continue;
    }
    if (o.texto && o.texto.length > 40) avisos.push(`Overlay ${o.id}: texto largo (${o.texto.length} car.)`);
    overlays.push({ ...o, inicio, fin });
  }
  // un solo chip_amenity visible a la vez
  const chips = overlays.filter((o) => o.tipo === "chip_amenity").sort((a, b) => a.inicio - b.inicio);
  const drop = new Set<string>();
  for (let i = 0; i < chips.length - 1; i++) {
    const a = chips[i]!;
    const b = chips[i + 1]!;
    if (a.fin > b.inicio) {
      a.fin = r2(b.inicio);
      if (a.fin - a.inicio < 0.6) drop.add(a.id);
    }
  }
  if (drop.size) avisos.push(`Chips superpuestos descartados: ${[...drop].join(", ")}`);
  overlays = overlays.filter((o) => !drop.has(o.id));
  // tarjeta final garantizada
  if (!overlays.some((o) => o.tipo === "tarjeta_final") && c.extensionFinal > 0) {
    overlays.push({ id: "tarjeta_final", tipo: "tarjeta_final", inicio: r2(c.duracion), fin: r2(total), texto: null, subtexto: null, icono: null, posicion: null });
    avisos.push("Se agregó la tarjeta final");
  }
  if (!overlays.some((o) => o.tipo === "barra_progreso")) overlays.push({ id: "progreso", tipo: "barra_progreso", inicio: 0, fin: r2(total), texto: null, subtexto: null, icono: null, posicion: null });

  // --- inserts
  let inserts: Insert[] = [];
  for (const i of plan.inserts) {
    if (!c.imagenes.has(i.imagen)) {
      avisos.push(`Insert ${i.id}: la imagen ${i.imagen} no existe`);
      continue;
    }
    const inicio = clamp(i.inicio);
    let fin = clamp(Math.min(i.fin, c.duracion));
    if (fin - inicio > 4) fin = r2(inicio + 4);
    if (fin - inicio < 0.8) {
      avisos.push(`Insert ${i.id} descartado (muy corto o fuera del video)`);
      continue;
    }
    inserts.push({ ...i, inicio, fin });
  }
  inserts.sort((a, b) => a.inicio - b.inicio);
  for (let k = 0; k < inserts.length - 1; k++) {
    const a = inserts[k]!;
    const b = inserts[k + 1]!;
    if (a.fin > b.inicio) a.fin = r2(b.inicio);
  }
  inserts = inserts.filter((i) => i.fin - i.inicio >= 0.8);
  // máximo 40 % del video en inserts
  let acum = 0;
  const limite = c.duracion * 0.4;
  inserts = inserts.filter((i) => {
    acum += i.fin - i.inicio;
    if (acum > limite) {
      avisos.push(`Insert ${i.id} descartado (supera el 40 % del video)`);
      return false;
    }
    return true;
  });

  // --- voz en off: dentro del video
  const vo = plan.vo.filter((v) => v.texto.trim()).map((v) => ({ ...v, inicio: clamp(v.inicio) }));
  return { plan: { ...plan, overlays: overlays.sort((a, b) => a.inicio - b.inicio), inserts, vo }, avisos };
}

export function resumenPlan(plan: EditPlan): string {
  const f = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
  const filas: { t: number; s: string }[] = [
    ...plan.overlays.filter((o) => o.tipo !== "barra_progreso").map((o) => ({ t: o.inicio, s: `${f(o.inicio)}-${f(o.fin)} ${o.tipo}${o.texto ? `: ${o.texto}` : ""}` })),
    ...plan.inserts.map((i) => ({ t: i.inicio, s: `${f(i.inicio)}-${f(i.fin)} 🖼 ${i.imagen}` })),
    ...plan.vo.map((v) => ({ t: v.inicio, s: `${f(v.inicio)} 🎙 "${v.texto.slice(0, 40)}"` })),
  ];
  return filas.sort((a, b) => a.t - b.t).map((x) => x.s).join("\n");
}
