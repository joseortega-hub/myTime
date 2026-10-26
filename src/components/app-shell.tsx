"use client";
import {
  Bell,
  CalendarDays,
  Clock3,
  Gift,
  LayoutDashboard,
  ListChecks,
  Map,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ThemeMenu } from "./theme-menu";
import { cx } from "./ui";

type NavItem = { href: string; label: string; short?: string; icon: typeof Bell };
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ href: "/", label: "Inicio", icon: LayoutDashboard }],
  },
  {
    label: "Planificar",
    items: [
      { href: "/calendario", label: "Calendario", icon: CalendarDays },
      { href: "/vacaciones", label: "Mapa de vacaciones", short: "Vacaciones", icon: Map },
      { href: "/optimizador", label: "Optimizador", icon: Sparkles },
      { href: "/equipo", label: "Equipo", icon: Users },
    ],
  },
  {
    label: "Registrar",
    items: [
      { href: "/ausencias", label: "Ausencias", icon: ListChecks },
      { href: "/compensados", label: "Compensados", icon: Gift },
      { href: "/guardias", label: "Guardias", icon: ShieldCheck },
      { href: "/horas", label: "Horas", icon: Clock3 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/alertas", label: "Alertas", icon: Bell },
      { href: "/ajustes", label: "Ajustes", icon: Settings },
    ],
  },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);
const MOBILE_PRIMARY = ["/", "/calendario", "/vacaciones", "/horas"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children, alertCount, jiraMode }: { children: ReactNode; alertCount: number; jiraMode: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const badge = (href: string) =>
    href === "/alertas" && alertCount > 0 ? (
      <span className="ml-auto rounded-full bg-pending px-1.5 text-[11px] font-semibold text-surface tabular" aria-label={`${alertCount} alertas`}>
        {alertCount}
      </span>
    ) : null;

  return (
    <div className="min-h-dvh max-md:px-safe md:pl-60">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow">
        Saltar al contenido
      </a>

      {/* Escritorio: barra lateral */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-ink">M</span>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">MyTime</p>
            <p className="text-[11px] text-ink-faint">Modo personal</p>
          </div>
        </div>
        <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((g) => (
            <div key={g.label ?? "inicio"} className="mb-3 space-y-0.5">
              {g.label && <p className="px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">{g.label}</p>}
          {g.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary-soft text-primary-strong" : "text-ink-soft hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
                {label}
                {badge(href)}
              </Link>
            );
          })}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-line py-2 pr-3 pl-5">
          <p className="flex-1 text-[11px] text-ink-faint">
            Jira: {jiraMode === "disabled" ? "sin conexión" : jiraMode === "mock" ? "modo simulado" : "solo lectura"}
          </p>
          <ThemeMenu placement="up" />
        </div>
      </aside>

      {/* Móvil: cabecera */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center gap-2.5 px-4 short:h-11">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-ink">M</span>
        <p className="font-semibold">MyTime</p>
        <div className="ml-auto"><ThemeMenu placement="down" /></div>
        <Link href="/alertas" className="relative grid size-11 place-items-center rounded-lg text-ink-soft active:bg-hover" aria-label={`Alertas (${alertCount})`}>
          <Bell className="size-5" />
          {alertCount > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-pending" />}
        </Link>
        </div>
      </header>

      <main id="contenido" className="mx-auto max-w-6xl px-4 pt-6 pb-28 short:pt-3 short:pb-20 md:px-8 md:pt-8 md:pb-12">
        {children}
      </main>

      {/* Móvil: navegación inferior */}
      <nav aria-label="Principal móvil" className="px-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.href)).map(({ href, label, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-transform active:scale-95 short:min-h-11 short:flex-row short:gap-1.5", active ? "text-primary" : "text-ink-soft")}>
              <Icon className="size-5" aria-hidden />
              {short ?? label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-ink-soft transition-transform active:scale-95 short:min-h-11 short:flex-row short:gap-1.5" aria-expanded={moreOpen}>
          <MoreHorizontal className="size-5" aria-hidden />
          Más
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Más secciones">
          <button type="button" className="absolute inset-0 bg-black/30" aria-label="Cerrar" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-4 pb-8 shadow-[var(--shadow-pop)]">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">Más secciones</p>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-md p-1 text-ink-faint" aria-label="Cerrar">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href)).map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={() => setMoreOpen(false)} className="flex flex-col items-center gap-1 rounded-xl border border-line p-3 text-xs font-medium">
                  <Icon className="size-5 text-primary" aria-hidden />
                  {label}
                  {href === "/alertas" && alertCount > 0 && <span className="text-[10px] text-pending">{alertCount} activas</span>}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
