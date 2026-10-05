import { z } from "zod";

export const OVERLAY_TIPOS = ["titulo", "chip_amenity", "lower_third", "etiqueta", "precio", "tarjeta_final", "barra_progreso"] as const;
export const POSICIONES = ["arriba_izq", "arriba_der", "arriba_centro", "centro", "abajo_izq", "abajo_centro"] as const;

export const overlaySchema = z.object({
  id: z.string(),
  tipo: z.enum(OVERLAY_TIPOS),
  inicio: z.number().min(0),
  fin: z.number().min(0),
  texto: z.string().nullable(),
  subtexto: z.string().nullable(),
  icono: z.string().nullable(),
  posicion: z.enum(POSICIONES).nullable(),
});
export type Overlay = z.infer<typeof overlaySchema>;

export const insertSchema = z.object({
  id: z.string(),
  /** Nombre del archivo dentro de 04_extendidas/ (ej. img_003.png). */
  imagen: z.string(),
  inicio: z.number().min(0),
  fin: z.number().min(0),
  modo: z.enum(["pantalla_completa", "panel"]),
  movimiento: z.enum(["zoom_in", "zoom_out", "paneo_izq", "paneo_der", "estatico"]),
});
export type Insert = z.infer<typeof insertSchema>;

export const voSchema = z.object({ id: z.string(), texto: z.string(), inicio: z.number().min(0) });

/** Lo que genera el LLM del Agente 5 (el resto del plan lo completa el código). */
export const planLlmSchema = z.object({
  guion: z.string(),
  overlays: z.array(overlaySchema),
  inserts: z.array(insertSchema),
  vo: z.array(voSchema),
  musica_volumen: z.number().min(0).max(1),
});
export type PlanLlm = z.infer<typeof planLlmSchema>;

export const editPlanSchema = z.object({
  version: z.literal(1),
  video: z.object({
    archivo: z.string(),
    duracion_s: z.number().positive(),
    fps: z.number().positive(),
    ancho: z.number().int().positive(),
    alto: z.number().int().positive(),
  }),
  salida: z.object({
    ancho: z.number().int().positive(),
    alto: z.number().int().positive(),
    fps: z.number().positive(),
    /** Segundos de congelado oscuro al final para la tarjeta final. */
    extension_final_s: z.number().min(0),
  }),
  captions: z.object({
    fuente: z.string(),
    grupo_palabras: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  }),
  overlays: z.array(overlaySchema),
  inserts: z.array(insertSchema),
  vo: z.array(voSchema.extend({ archivo: z.string().nullable(), duracion_s: z.number().nullable() })),
  musica: z.object({ archivo: z.string().nullable(), volumen: z.number().min(0).max(1), ducking: z.boolean() }),
  guion: z.string(),
});
export type EditPlan = z.infer<typeof editPlanSchema>;

/** Línea de tiempo de escenas del video grabado (salida del análisis de frames). */
export const analisisVideoSchema = z.object({
  segmentos: z.array(
    z.object({
      inicio: z.number().min(0),
      fin: z.number().min(0),
      que_se_ve: z.string(),
      ambiente: z.string().nullable(),
      habla_presentador: z.boolean(),
      zona_libre: z.enum(["arriba", "abajo", "izquierda", "derecha", "ninguna"]),
    }),
  ),
});
export type AnalisisVideo = z.infer<typeof analisisVideoSchema>;

/** Corrección de nombres propios en la transcripción (índice de palabra → texto corregido). */
export const correccionSchema = z.object({
  correcciones: z.array(z.object({ indice: z.number().int().min(0), texto: z.string() })),
});

export const TRANSICIONES = ["fade", "slide", "wipe", "zoom", "whip", "corte"] as const;

export const estiloSchema = z.object({
  nombre: z.string(),
  paleta: z.object({ primario: z.string(), acento: z.string(), fondo: z.string(), texto: z.string() }),
  tipografia: z.object({ titulos: z.string(), cuerpo: z.string(), subtitulos: z.string() }),
  subtitulos: z.object({
    posicion: z.enum(["abajo", "centro", "arriba"]),
    tamano_rel: z.number().min(0.02).max(0.12),
    resaltado: z.enum(["color", "fondo", "escala"]),
    animacion: z.enum(["pop", "fade", "ninguna"]),
    contorno: z.boolean(),
    mayusculas: z.boolean(),
  }),
  transiciones: z.array(z.object({ tipo: z.enum(TRANSICIONES), duracion_s: z.number().min(0).max(2) })),
  ritmo: z.object({ cortes_por_min: z.number().min(0) }),
  easing: z.object({ rigidez: z.number().min(1), amortiguacion: z.number().min(1) }),
  motion_graphics: z.array(z.object({ patron: z.string(), descripcion: z.string(), posicion: z.string() })),
  color: z.object({ vineta: z.number().min(0).max(1), contraste: z.number().min(0.5).max(1.5) }),
  imagenes: z.object({
    movimiento: z.enum(["zoom_in", "zoom_out", "paneo_izq", "paneo_der", "estatico"]),
    duracion_media_s: z.number().min(0.5).max(8),
  }),
  notas: z.string(),
});
export type Estilo = z.infer<typeof estiloSchema>;

export const ESTILO_BASE: Estilo = {
  nombre: "base",
  paleta: { primario: "#0d2b1e", acento: "#b8f04a", fondo: "#000000", texto: "#ffffff" },
  tipografia: { titulos: "Inter", cuerpo: "Inter", subtitulos: "Inter" },
  subtitulos: { posicion: "abajo", tamano_rel: 0.062, resaltado: "color", animacion: "pop", contorno: true, mayusculas: true },
  transiciones: [{ tipo: "fade", duracion_s: 0.25 }],
  ritmo: { cortes_por_min: 20 },
  easing: { rigidez: 140, amortiguacion: 18 },
  motion_graphics: [],
  color: { vineta: 0.35, contraste: 1.05 },
  imagenes: { movimiento: "zoom_in", duracion_media_s: 2 },
  notas: "Estilo base de respaldo (sin plantilla analizada).",
};
