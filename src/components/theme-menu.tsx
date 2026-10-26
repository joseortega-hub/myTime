"use client";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_PALETTE, MODE_KEY, PALETTE_KEY, PALETTES, type EffectiveTheme, type ThemeMode } from "@/lib/theme";
import { cx } from "./ui";

const MODES: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "Sistema", Icon: Monitor },
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Oscuro", Icon: Moon },
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: el cambio dura hasta recargar.
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readMode(): ThemeMode {
  const m = read(MODE_KEY);
  return m === "light" || m === "dark" ? m : "system";
}
function readPalette(): string {
  const p = read(PALETTE_KEY);
  return PALETTES.some((x) => x.id === p) ? p! : DEFAULT_PALETTE;
}
function effectiveOf(mode: ThemeMode): EffectiveTheme {
  return mode === "system" ? (media().matches ? "dark" : "light") : mode;
}
function apply() {
  document.documentElement.dataset.theme = effectiveOf(readMode());
  document.documentElement.dataset.palette = readPalette();
}

// Almacén externo mínimo: preferencias en localStorage + modo del sistema.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = media();
  const onSystem = () => {
    apply();
    cb();
  };
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystem);
  };
}
const snapshot = () => `${readMode()}|${readPalette()}|${effectiveOf(readMode())}`;
const serverSnapshot = () => `system|${DEFAULT_PALETTE}|light`;

/** Botón de paleta con el menú de estilos y el modo Sistema · Claro · Oscuro. */
export function ThemeMenu({ placement = "up" }: { placement?: "up" | "down" }) {
  const [open, setOpen] = useState(false);
  const [mode, palette, effective] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|") as [ThemeMode, string, EffectiveTheme];
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = useCallback((next: { mode?: ThemeMode; palette?: string }) => {
    if (next.mode) write(MODE_KEY, next.mode);
    if (next.palette) write(PALETTE_KEY, next.palette);
    apply();
    for (const l of listeners) l();
  }, []);

  const current = PALETTES.find((p) => p.id === palette);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Cambiar el estilo (ahora: ${current?.label ?? palette}, ${effective === "dark" ? "oscuro" : "claro"})`}
        className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink"
      >
        <Palette className="size-[18px]" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Estilo y modo"
          className={cx(
            "absolute z-50 w-[min(20rem,calc(100vw-24px))] rounded-[var(--radius-card)] border border-line bg-surface p-2 text-ink shadow-[var(--shadow-pop)]",
            placement === "up" ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2",
          )}
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Estilo</p>
          <div role="radiogroup" aria-label="Estilo" className="flex flex-col gap-0.5">
            {PALETTES.map((p) => {
              const selected = p.id === palette;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choose({ palette: p.id })}
                  className={cx(
                    "flex min-h-12 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-primary-soft text-primary-strong" : "hover:bg-hover",
                  )}
                >
                  <span className="flex shrink-0 overflow-hidden rounded-md border border-line" aria-hidden>
                    {p.swatches[effective].map((c, i) => <span key={i} className="h-7 w-3" style={{ background: c }} />)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold">{p.label}</span>
                    <span className={cx("text-xs leading-snug", selected ? "opacity-80" : "text-ink-soft")}>{p.description}</span>
                  </span>
                  <Check className={cx("size-4 shrink-0", !selected && "invisible")} aria-hidden />
                </button>
              );
            })}
          </div>
          <div role="radiogroup" aria-label="Modo" className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-canvas p-1">
            {MODES.map(({ id, label, Icon }) => {
              const selected = id === mode;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choose({ mode: id })}
                  className={cx(
                    "flex min-h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors",
                    selected ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
