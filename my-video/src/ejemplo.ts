import type { EdicionProps } from "./types";

/** Props de ejemplo para previsualizar la composición en Remotion Studio (usa public/ejemplo.mp4 si existe). */
export const ejemplo: EdicionProps = {
  plan: {
    version: 1,
    video: { archivo: "ejemplo.mp4", duracion_s: 8, fps: 30, ancho: 1080, alto: 1920 },
    salida: { ancho: 1080, alto: 1920, fps: 30, extension_final_s: 2.5 },
    captions: { fuente: "transcripcion.json", grupo_palabras: [2, 4] },
    overlays: [
      { id: "t1", tipo: "titulo", inicio: 0.2, fin: 2.7, texto: "Finca Dos", subtexto: "BARRIO PRIVADO", icono: null, posicion: "abajo_izq" },
      { id: "e1", tipo: "etiqueta", inicio: 3, fin: 6, texto: "VISTA AÉREA", subtexto: null, icono: null, posicion: "arriba_izq" },
      { id: "c1", tipo: "chip_amenity", inicio: 3, fin: 4.8, texto: "Laguna", subtexto: null, icono: "lago", posicion: "arriba_der" },
      { id: "c2", tipo: "chip_amenity", inicio: 5, fin: 6.8, texto: "Canchas de pádel", subtexto: null, icono: "cancha", posicion: "arriba_der" },
      { id: "p", tipo: "barra_progreso", inicio: 0, fin: 10.5, texto: null, subtexto: null, icono: null, posicion: null },
      { id: "fin", tipo: "tarjeta_final", inicio: 8, fin: 10.5, texto: "Finca Dos", subtexto: "BARRIO PRIVADO", icono: null, posicion: null },
    ],
    inserts: [],
    vo: [],
    musica: { archivo: null, volumen: 0.12, ducking: true },
    guion: "",
  },
  estilo: {
    nombre: "ejemplo",
    paleta: { primario: "#0d2b1e", acento: "#b8f04a", fondo: "#000000", texto: "#ffffff" },
    tipografia: { titulos: "Inter", cuerpo: "Inter", subtitulos: "Inter" },
    subtitulos: { posicion: "abajo", tamano_rel: 0.042, resaltado: "color", animacion: "pop", contorno: true, mayusculas: true },
    transiciones: [{ tipo: "fade", duracion_s: 0.25 }],
    ritmo: { cortes_por_min: 20 },
    easing: { rigidez: 140, amortiguacion: 18 },
    motion_graphics: [],
    color: { vineta: 0.35, contraste: 1.05 },
    imagenes: { movimiento: "zoom_in", duracion_media_s: 2 },
    notas: "",
  },
  cliente: { nombre: "Inmobiliaria Demo", colores: { primario: "#0d2b1e", acento: "#b8f04a", texto: "#ffffff" }, logo: null, contacto: { telefono: "", whatsapp: "+54 9 351 000 0000", web: "inmobiliariademo.com", instagram: "@inmobiliariademo", email: "" }, cta: "Coordiná tu visita" },
  palabras: "Hoy vengo a conocer el barrio privado Finca Dos con su laguna y sus canchas de pádel"
    .split(" ")
    .map((texto, i) => ({ texto, inicio_ms: 300 + i * 420, fin_ms: 300 + i * 420 + 380 })),
  fuentes: [],
};
