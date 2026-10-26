"use client";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

/**
 * Aplica el estilo y el modo guardados antes del primer pintado (sin parpadeo).
 * En el servidor se emite como script ejecutable; en el cliente como texto
 * plano para que React no lo vuelva a ejecutar ni avise (guía de Next.js
 * "Preventing flash before hydration").
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
    />
  );
}
