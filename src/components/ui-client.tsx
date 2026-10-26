"use client";
/**
 * Componentes interactivos: diálogos, confirmaciones y avisos (toasts), y el
 * gancho `useAction` que llama a las acciones de servidor con gestión de errores.
 */
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/result";
import { Button, cx } from "./ui";

// ── Diálogo ─────────────────────────────────────────────────

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-3xl",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-faint hover:bg-hover hover:text-ink" aria-label="Cerrar">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ── Confirmaciones ─────────────────────────────────────────

type ConfirmOptions = { title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

// ── Avisos ─────────────────────────────────────────────────

type Toast = { id: number; tone: "success" | "error" | "warning" | "info"; message: string };
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const counter = useRef(0);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++counter.current;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 5000);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <Dialog
          open={confirmState != null}
          onClose={() => close(false)}
          title={confirmState?.title ?? ""}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)}>Cancelar</Button>
              <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                {confirmState?.confirmLabel ?? "Confirmar"}
              </Button>
            </>
          }
        >
          {confirmState?.description && <div className="text-sm text-ink-soft">{confirmState.description}</div>}
        </Dialog>
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={cx(
                "pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-pop)]",
                t.tone === "success" && "border-approved/40 bg-surface text-ink",
                t.tone === "error" && "border-danger/40 bg-surface text-ink",
                t.tone === "warning" && "border-pending/40 bg-surface text-ink",
                t.tone === "info" && "border-line bg-surface text-ink",
              )}
            >
              <span className={cx("mr-2 inline-block size-2 rounded-full align-middle", t.tone === "success" && "bg-approved", t.tone === "error" && "bg-danger", t.tone === "warning" && "bg-pending", t.tone === "info" && "bg-info")} />
              {t.message}
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

/**
 * Ejecuta una acción de servidor mostrando errores/avisos. Si el servidor
 * pide confirmación (p. ej. por solapamiento), pregunta y reintenta con
 * `confirmed = true`.
 */
export function useAction() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(
      fn: (confirmed: boolean) => Promise<ActionResult<T>>,
      opts: { success?: string; onSuccess?: (data: T) => void; refresh?: boolean } = {},
    ): Promise<T | undefined> => {
      setFieldErrors({});
      setBusy(true);
      let result: ActionResult<T>;
      try {
        result = await fn(false);
        if (!result.ok && result.needsConfirmation) {
          const ok = await confirm({ title: "¿Guardar de todos modos?", description: result.error, confirmLabel: "Guardar igualmente" });
          if (!ok) return undefined;
          result = await fn(true);
        }
      } catch {
        toast({ tone: "error", message: "No se ha podido contactar con el servidor." });
        return undefined;
      } finally {
        setBusy(false);
      }
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast({ tone: "error", message: result.error });
        return undefined;
      }
      if (opts.success) toast({ tone: "success", message: opts.success });
      for (const w of result.warnings ?? []) toast({ tone: "warning", message: w });
      opts.onSuccess?.(result.data);
      if (opts.refresh !== false) startTransition(() => router.refresh());
      // Éxito sin datos: se devuelve null para distinguirlo de un fallo (undefined).
      return (result.data ?? null) as T;
    },
    [confirm, router, toast],
  );

  return { run, pending: pending || busy, fieldErrors };
}
