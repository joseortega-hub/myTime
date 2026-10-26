import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeScript } from "@/components/theme-script";
import { UIProvider } from "@/components/ui-client";
import { DEFAULT_PALETTE } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MyTime", template: "%s · MyTime" },
  description: "Gestión personal de vacaciones, festivos, compensados, guardias y horas.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "MyTime", statusBarStyle: "default" },
};

// viewport-fit=cover: la app instalada ocupa toda la pantalla; las zonas seguras se respetan con pt-safe/px-safe.
export const viewport: Viewport = { themeColor: "#0f766e", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-theme="light" data-palette={DEFAULT_PALETTE} className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  );
}
