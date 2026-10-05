/**
 * Props de la composición "Edicion". Reflejan los esquemas zod del bot
 * (bot/src/schemas/plan.ts y cliente.ts): si cambian allá, actualizarlos acá.
 */
export type Posicion = "arriba_izq" | "arriba_der" | "arriba_centro" | "centro" | "abajo_izq" | "abajo_centro";

export type Overlay = {
  id: string;
  tipo: "titulo" | "chip_amenity" | "lower_third" | "etiqueta" | "precio" | "tarjeta_final" | "barra_progreso";
  inicio: number;
  fin: number;
  texto: string | null;
  subtexto: string | null;
  icono: string | null;
  posicion: Posicion | null;
};

export type Insert = {
  id: string;
  imagen: string;
  inicio: number;
  fin: number;
  modo: "pantalla_completa" | "panel";
  movimiento: "zoom_in" | "zoom_out" | "paneo_izq" | "paneo_der" | "estatico";
};

export type Plan = {
  version: 1;
  video: { archivo: string; duracion_s: number; fps: number; ancho: number; alto: number };
  salida: { ancho: number; alto: number; fps: number; extension_final_s: number };
  captions: { fuente: string; grupo_palabras: [number, number] };
  overlays: Overlay[];
  inserts: Insert[];
  vo: { id: string; texto: string; inicio: number; archivo: string | null; duracion_s: number | null }[];
  musica: { archivo: string | null; volumen: number; ducking: boolean };
  guion: string;
};

export type Estilo = {
  nombre: string;
  paleta: { primario: string; acento: string; fondo: string; texto: string };
  tipografia: { titulos: string; cuerpo: string; subtitulos: string };
  subtitulos: {
    posicion: "abajo" | "centro" | "arriba";
    tamano_rel: number;
    resaltado: "color" | "fondo" | "escala";
    animacion: "pop" | "fade" | "ninguna";
    contorno: boolean;
    mayusculas: boolean;
  };
  transiciones: { tipo: string; duracion_s: number }[];
  ritmo: { cortes_por_min: number };
  easing: { rigidez: number; amortiguacion: number };
  motion_graphics: { patron: string; descripcion: string; posicion: string }[];
  color: { vineta: number; contraste: number };
  imagenes: { movimiento: Insert["movimiento"]; duracion_media_s: number };
  notas: string;
};

export type Palabra = { texto: string; inicio_ms: number; fin_ms: number };

export type EdicionProps = {
  plan: Plan;
  estilo: Estilo;
  cliente: {
    nombre: string;
    colores: { primario: string; acento: string; texto: string };
    logo: string | null;
    contacto: { telefono: string; whatsapp: string; web: string; instagram: string; email: string };
    cta: string;
  };
  palabras: Palabra[];
  fuentes: { nombre: string; archivo: string }[];
};
