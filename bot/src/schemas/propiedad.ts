import { z } from "zod";

const monto = z.number().nullable();

/** Lo que devuelve el LLM del Agente 1 (todo nullable: "no está en la página" = null). */
export const propiedadLlmSchema = z.object({
  titulo: z.string().nullable(),
  tipo_operacion: z.enum(["venta", "alquiler", "alquiler_temporal"]).nullable(),
  tipo_propiedad: z.string().nullable(),
  precio: z.object({ monto, moneda: z.enum(["USD", "ARS", "EUR"]).nullable() }),
  expensas: monto,
  ubicacion: z.object({
    direccion: z.string().nullable(),
    barrio: z.string().nullable(),
    ciudad: z.string().nullable(),
    provincia: z.string().nullable(),
    pais: z.string().nullable(),
  }),
  superficie: z.object({ total_m2: monto, cubierta_m2: monto, terreno_m2: monto }),
  ambientes: z.number().nullable(),
  dormitorios: z.number().nullable(),
  banos: z.number().nullable(),
  cocheras: z.number().nullable(),
  antiguedad: z.string().nullable(),
  amenities: z.array(z.string()),
  caracteristicas: z.array(z.string()),
  descripcion: z.string().nullable(),
  contacto: z.object({ nombre: z.string().nullable(), telefono: z.string().nullable(), email: z.string().nullable() }),
  /** Índices (de la lista [IMG#n] del prompt) de las imágenes que son fotos de la propiedad. */
  indices_imagenes: z.array(z.number().int()),
});
export type PropiedadLlm = z.infer<typeof propiedadLlmSchema>;

export const propiedadSchema = propiedadLlmSchema.omit({ indices_imagenes: true }).extend({
  url_fuente: z.string(),
  imagenes: z.array(z.object({ url: z.string(), alt: z.string().nullable() })),
  videos: z.array(z.object({ url: z.string(), tipo: z.enum(["mp4", "youtube", "vimeo", "otro"]) })),
  campos_faltantes: z.array(z.string()),
  capturado: z.string(),
});
export type Propiedad = z.infer<typeof propiedadSchema>;

/** Campos que, si están vacíos, se avisan al usuario. */
export function camposFaltantes(p: PropiedadLlm): string[] {
  const falta: string[] = [];
  if (!p.titulo) falta.push("titulo");
  if (!p.tipo_operacion) falta.push("tipo_operacion");
  if (p.precio.monto == null) falta.push("precio");
  if (!p.ubicacion.barrio && !p.ubicacion.ciudad && !p.ubicacion.direccion) falta.push("ubicacion");
  if (p.superficie.total_m2 == null && p.superficie.cubierta_m2 == null && p.superficie.terreno_m2 == null) falta.push("superficie");
  if (p.ambientes == null && p.dormitorios == null) falta.push("ambientes/dormitorios");
  if (!p.descripcion) falta.push("descripcion");
  if (p.amenities.length === 0) falta.push("amenities");
  return falta;
}

export const imagenIndiceSchema = z.object({
  version: z.literal(1),
  imagenes: z.array(
    z.object({
      archivo: z.string(),
      ancho: z.number(),
      alto: z.number(),
      orientacion: z.enum(["horizontal", "vertical", "cuadrada"]),
      url: z.string(),
      hash: z.string(),
    }),
  ),
  descartadas: z.array(z.object({ url: z.string(), motivo: z.string() })),
});
export type ImagenIndice = z.infer<typeof imagenIndiceSchema>;

/** Salida del LLM de visión por imagen (Agente 3). */
export const analisisImagenSchema = z.object({
  tipo_ambiente: z.string(),
  descripcion_corta: z.string(),
  calidad: z.number().int().min(1).max(5),
  orientacion_original: z.enum(["horizontal", "vertical", "cuadrada"]),
  estrategia_extension: z.enum(["ninguna", "arriba_y_abajo", "solo_arriba", "solo_abajo"]),
  prompt_extension: z.string(),
  riesgos: z.array(z.string()),
  usable: z.boolean(),
});
export type AnalisisImagen = z.infer<typeof analisisImagenSchema>;
