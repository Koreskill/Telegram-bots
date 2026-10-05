import React from "react";

/** Íconos SVG propios (24×24, trazo). Nombre libre: si no existe se usa una estrella. */
const PATHS: Record<string, React.ReactNode> = {
  lago: <><path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4-1.5 6-.5" /><path d="M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4-1.5 6-.5" /><path d="M2 19c2.5-2 4.5-2 7 0s4.5 2 7 0 4-1.5 6-.5" /></>,
  cancha: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14" /><circle cx="12" cy="12" r="2.5" /></>,
  pileta: <><path d="M8 4v11M16 4v11M8 8h8M8 12h8" /><path d="M2 18c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" /></>,
  parrilla: <><path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 2 2 1-1-2-1-3 0-5z" /><path d="M5 20h14" /></>,
  gimnasio: <><path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" /></>,
  seguridad: <><path d="M12 3l8 3v6c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  parque: <><path d="M12 21v-6" /><path d="M12 15c-4 0-6-2.5-6-5.5 0-2.5 2-4 3-4.5.5-2 2-3 3-3s2.5 1 3 3c1 .5 3 2 3 4.5 0 3-2 5.5-6 5.5z" /></>,
  ingreso: <><path d="M5 21V8l7-5 7 5v13" /><path d="M9 21v-7h6v7" /></>,
  vista: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  cochera: <><path d="M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16" /><rect x="3" y="16" width="18" height="4" rx="1" /><circle cx="7.5" cy="18" r=".8" /><circle cx="16.5" cy="18" r=".8" /></>,
  ubicacion: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  estrella: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

/** Palabras que el LLM suele usar → ícono. */
const ALIAS: [RegExp, string][] = [
  [/lago|laguna|agua|lake/, "lago"],
  [/cancha|p[aá]del|f[uú]tbol|tenis|deport|golf/, "cancha"],
  [/pileta|piscina|pool/, "pileta"],
  [/parrilla|quincho|asador|fuego/, "parrilla"],
  [/gimnasio|gym|fitness/, "gimnasio"],
  [/seguridad|vigilancia|cerrado|privado/, "seguridad"],
  [/parque|verde|plaza|arbol|árbol|naturaleza/, "parque"],
  [/ingreso|acceso|port[oó]n|entrada/, "ingreso"],
  [/vista|panor|mirador/, "vista"],
  [/cochera|garage|garaje|auto/, "cochera"],
  [/ubicaci|mapa|zona|barrio/, "ubicacion"],
];

export const Icono: React.FC<{ nombre: string | null; size: number; color: string }> = ({ nombre, size, color }) => {
  const clave = (nombre ?? "").toLowerCase();
  const key = ALIAS.find(([re]) => re.test(clave))?.[1] ?? Object.keys(PATHS).find((k) => clave.includes(k)) ?? "estrella";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[key]}
    </svg>
  );
};
