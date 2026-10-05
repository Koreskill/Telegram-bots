import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color hex #rrggbb");

/**
 * cliente.json — vive en clientes/<cliente>/cliente.json. Todos los campos tienen valor por
 * defecto para que un cliente "mínimo" (solo la carpeta) ya funcione.
 */
export const clienteSchema = z.object({
  nombre: z.string().min(1),
  marca: z
    .object({
      colores: z
        .object({
          primario: color.default("#0d2b1e"),
          acento: color.default("#b8f04a"),
          texto: color.default("#ffffff"),
        })
        .default({ primario: "#0d2b1e", acento: "#b8f04a", texto: "#ffffff" }),
      /** Nombre de la fuente (se busca primero en plantilla/fuentes). */
      fuente: z.string().default("Inter"),
      /** Ruta del logo relativa a la carpeta del cliente (ej. "logo.png"). */
      logo: z.string().nullable().default(null),
    })
    .default({ colores: { primario: "#0d2b1e", acento: "#b8f04a", texto: "#ffffff" }, fuente: "Inter", logo: null }),
  contacto: z
    .object({
      telefono: z.string().default(""),
      whatsapp: z.string().default(""),
      web: z.string().default(""),
      instagram: z.string().default(""),
      email: z.string().default(""),
    })
    .default({ telefono: "", whatsapp: "", web: "", instagram: "", email: "" }),
  tono: z.string().default("cálido, profesional y cercano"),
  idioma: z.string().default("es-AR"),
  cta_por_defecto: z.string().default("Coordiná tu visita"),
  /** Si el cliente autorizó bajar videos embebidos de YouTube/Vimeo de su propia web. */
  permite_descargar_video_embed: z.boolean().default(false),
  /** Nombre de la carpeta en plantilla/estilos/ que se usa si no se indica uno. */
  estilo_por_defecto: z.string().nullable().default(null),
  voz: z
    .object({
      voice: z.string().nullable().default(null),
      instrucciones: z.string().default(""),
    })
    .default({ voice: null, instrucciones: "" }),
  zernio: z
    .object({
      cuentas: z
        .array(z.object({ plataforma: z.enum(["instagram", "tiktok", "youtube", "facebook", "threads", "linkedin"]), accountId: z.string() }))
        .default([]),
    })
    .default({ cuentas: [] }),
});
export type Cliente = z.infer<typeof clienteSchema>;

export function clienteVacio(nombre: string): Cliente {
  return clienteSchema.parse({ nombre });
}
