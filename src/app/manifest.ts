import type { MetadataRoute } from "next";

/** Permite instalar MyTime en el móvil (necesario en iPhone para recibir avisos). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyTime",
    short_name: "MyTime",
    description: "Vacaciones, festivos, compensados, guardias y horas.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#0f766e",
    lang: "es",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
