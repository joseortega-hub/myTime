/**
 * Componentes base de la interfaz (sin estado). Accesibles por teclado y con
 * estilos consistentes. Los que necesitan estado están en `ui-client.tsx`.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-strong shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-canvas",
  ghost: "text-ink-soft hover:bg-hover hover:text-ink",
  danger: "bg-danger text-surface hover:opacity-90",
  subtle: "bg-primary-soft text-primary-strong hover:brightness-95",
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  // En pantallas táctiles todos los botones miden al menos 44 px de alto.
  sm: "h-8 px-3 text-sm touch:h-11 touch:min-w-11 touch:px-3.5",
  md: "h-10 px-4 text-sm touch:h-11",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "planned" | "holiday";
const TONES: Record<Tone, string> = {
  neutral: "bg-rejected-soft text-ink-soft",
  primary: "bg-primary-soft text-primary-strong",
  success: "bg-approved-soft text-approved",
  warning: "bg-pending-soft text-pending",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  planned: "bg-planned-soft text-planned",
  holiday: "bg-holiday-soft text-holiday",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Etiqueta inequívoca para datos que no son reales. */
export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-pending bg-pending-soft px-1.5 text-[10px] font-semibold tracking-wide text-pending uppercase">
      {label}
    </span>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: "border-info/30 bg-info-soft text-ink",
    warning: "border-warning/30 bg-warning-soft text-ink",
    danger: "border-danger/30 bg-danger-soft text-ink",
    success: "border-approved/30 bg-approved-soft text-ink",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-xl border px-4 py-3 text-sm", styles, className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cx(title ? "mt-1" : null, "leading-relaxed opacity-90")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "primary" | "warning" | "muted" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className={cx("tabular mt-1 text-2xl font-semibold tracking-tight", tone === "primary" && "text-primary", tone === "warning" && "text-pending", tone === "muted" && "text-ink-faint")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

// touch:text-base: con menos de 16 px el iPhone hace zoom al tocar el campo.
const FIELD = "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm touch:text-base text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-canvas aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(FIELD, "h-10 touch:h-11", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(FIELD, "h-10 touch:h-11 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(FIELD, "py-2", className)} {...props} />;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function SegmentedLinks({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cx("inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors touch:min-h-11 touch:px-4", i.active ? "bg-primary text-primary-ink" : "text-ink-soft hover:text-ink")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Clases para enlaces de texto sueltos ("Ver todas"): zona táctil de 44 px en móvil. */
export const TEXT_LINK = "inline-flex items-center text-sm font-medium text-primary hover:underline touch:min-h-11";

export function formatDays(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}
