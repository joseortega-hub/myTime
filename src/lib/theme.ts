/**
 * Estilos visuales y modo claro/oscuro. Solo cambian variables CSS (ver
 * globals.css); la preferencia se guarda en este navegador.
 */
export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export interface PaletteInfo {
  id: string;
  label: string;
  description: string;
  /** Muestras [fondo, superficie, principal, acento] por modo, para el menú. */
  swatches: Record<EffectiveTheme, string[]>;
}

export const PALETTES: PaletteInfo[] = [
  {
    id: "teal",
    label: "Agua",
    description: "Verde azulado sereno. El estilo por defecto.",
    swatches: { light: ["#f7f7f5", "#ffffff", "#0f766e", "#be123c"], dark: ["#121413", "#1b1e1d", "#2dd4bf", "#fb7185"] },
  },
  {
    id: "indigo",
    label: "Enfoque",
    description: "Índigo frío, de herramienta de trabajo. Esquinas medias.",
    swatches: { light: ["#f5f6fb", "#ffffff", "#4f46e5", "#0369a1"], dark: ["#111219", "#1a1b26", "#818cf8", "#38bdf8"] },
  },
  {
    id: "terracota",
    label: "Mediterráneo",
    description: "Terracota cálida y formas suaves, para pensar en vacaciones.",
    swatches: { light: ["#faf6f1", "#fffdfa", "#c2410c", "#0f766e"], dark: ["#16120f", "#201a16", "#fb923c", "#2dd4bf"] },
  },
  {
    id: "pizarra",
    label: "Pizarra",
    description: "Casi monocromo y compacto, para concentrarse en los datos.",
    swatches: { light: ["#f5f6f7", "#ffffff", "#334155", "#64748b"], dark: ["#0f1113", "#181b1f", "#cbd5e1", "#94a3b8"] },
  },
  {
    id: "contraste",
    label: "Alto contraste",
    description: "Bordes marcados y texto más oscuro. Máxima legibilidad.",
    swatches: { light: ["#ffffff", "#ffffff", "#0b3d91", "#000000"], dark: ["#000000", "#0b0b0b", "#9cc3ff", "#ffffff"] },
  },
];

export const DEFAULT_PALETTE = "teal";
// Las mismas claves usa el script en línea del layout antes de pintar.
export const MODE_KEY = "mytime.theme";
export const PALETTE_KEY = "mytime.palette";

/** Script que se ejecuta antes del primer pintado para evitar parpadeos. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var m=localStorage.getItem("${MODE_KEY}");var p=localStorage.getItem("${PALETTE_KEY}");var ids=${JSON.stringify(PALETTES.map((p) => p.id))};var t=m==="light"||m==="dark"?m:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.dataset.theme=t;d.dataset.palette=ids.indexOf(p)>=0?p:"${DEFAULT_PALETTE}";}catch(e){}})();`;
