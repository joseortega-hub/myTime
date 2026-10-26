"use client";
import { History, ListChecks, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeAbsenceStatusAction, deleteAbsenceAction } from "@/app/actions";
import {
  ABSENCE_STATUS_LABEL,
  ABSENCE_STATUSES,
  ABSENCE_TYPE_LABEL,
  ABSENCE_TYPES,
  allowedTransitions,
  DAY_PORTION_LABEL,
  type AbsenceStatus,
  type AbsenceType,
  type DayPortion,
} from "@/domain/absences";
import type { WorkCalendarRules } from "@/domain/calendar";
import { formatRange } from "@/domain/dates";
import { AbsenceFormDialog, type AbsenceFormValues } from "./absence-form";
import { STATUS_DOT, STATUS_TONE } from "./absence-style";
import { Badge, Button, Card, EmptyState, Select, cx, formatDays } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";

export interface AbsenceListRow {
  id: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
  portion: DayPortion;
  daysOverride: number | null;
  notes: string | null;
  origin: string;
  externalSource: string | null;
  days: number;
  events: { id: string; fromStatus: AbsenceStatus | null; toStatus: AbsenceStatus; note: string | null; at: string }[];
}

const ORIGIN_LABEL: Record<string, string> = {
  manual: "Manual",
  optimizer: "Optimizador",
  import: "Importada",
  jira: "Jira",
  compensatory: "Compensados",
};

export function AbsenceList({
  rows, rules, year, status, type, currentYear,
}: {
  rows: AbsenceListRow[];
  rules: WorkCalendarRules;
  year: number | null;
  status: AbsenceStatus | null;
  type: AbsenceType | null;
  currentYear: number;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [form, setForm] = useState<AbsenceFormValues | null>(null);
  const [history, setHistory] = useState<AbsenceListRow | null>(null);

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { año: year == null ? "todos" : String(year), estado: status, tipo: type, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    router.push(`/ausencias?${p.toString()}`);
  };

  const totals = {
    requested: rows.filter((r) => r.status === "REQUESTED").reduce((s, r) => s + r.days, 0),
    approved: rows.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.days, 0),
    taken: rows.filter((r) => r.status === "TAKEN").reduce((s, r) => s + r.days, 0),
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-year" className="mb-1 block text-xs font-medium text-ink-soft">Año</label>
          <Select id="f-year" className="w-32" value={year == null ? "todos" : String(year)} onChange={(e) => go({ año: e.target.value })}>
            <option value="todos">Todos</option>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-ink-soft">Estado</label>
          <Select id="f-status" className="w-44" value={status ?? ""} onChange={(e) => go({ estado: e.target.value || null })}>
            <option value="">Todos</option>
            {ABSENCE_STATUSES.map((s) => <option key={s} value={s}>{ABSENCE_STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="f-type" className="mb-1 block text-xs font-medium text-ink-soft">Tipo</label>
          <Select id="f-type" className="w-44" value={type ?? ""} onChange={(e) => go({ tipo: e.target.value || null })}>
            <option value="">Todos</option>
            {ABSENCE_TYPES.map((t) => <option key={t} value={t}>{ABSENCE_TYPE_LABEL[t]}</option>)}
          </Select>
        </div>
        <p className="ml-auto text-sm text-ink-soft">
          <span className="font-medium text-ink tabular">{formatDays(totals.taken)}</span> disfrutados ·{" "}
          <span className="font-medium text-ink tabular">{formatDays(totals.approved)}</span> aprobados ·{" "}
          <span className="font-medium text-ink tabular">{formatDays(totals.requested)}</span> pendientes
        </p>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-5" />} title="No hay ausencias con estos filtros" description="Crea una nueva o cambia los filtros." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <span className={cx("size-2.5 shrink-0 rounded-full", STATUS_DOT[r.status])} aria-hidden />
                <div className="min-w-48 flex-1">
                  <p className={cx("text-sm font-medium", (r.status === "REJECTED" || r.status === "CANCELLED") && "text-ink-faint line-through")}>
                    {formatRange(r.startDate, r.endDate)}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {ABSENCE_TYPE_LABEL[r.type]}
                    {r.portion !== "FULL" && ` · ${DAY_PORTION_LABEL[r.portion]}`}
                    {" · "}
                    <span className="tabular">{formatDays(r.days)}</span> {r.days === 1 ? "día" : "días"}
                    {r.daysOverride != null && " (indicado a mano)"}
                    {" · "}
                    {ORIGIN_LABEL[r.origin] ?? r.origin}
                    {r.externalSource === "jira-mock" && " (simulado)"}
                  </p>
                  {r.notes && <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">{r.notes}</p>}
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{ABSENCE_STATUS_LABEL[r.status]}</Badge>
                <div className="flex items-center gap-1">
                  <label htmlFor={`st-${r.id}`} className="sr-only">Cambiar estado</label>
                  <select
                    id={`st-${r.id}`}
                    disabled={pending}
                    value=""
                    className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs"
                    onChange={(e) => {
                      const s = e.target.value as AbsenceStatus;
                      if (s) void run(() => changeAbsenceStatusAction(r.id, s), { success: `Marcada como ${ABSENCE_STATUS_LABEL[s].toLowerCase()}.` });
                    }}
                  >
                    <option value="">Marcar como…</option>
                    {allowedTransitions(r.status).map((s) => <option key={s} value={s}>{ABSENCE_STATUS_LABEL[s]}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" aria-label="Ver historial" onClick={() => setHistory(r)}><History className="size-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setForm({ ...r })}><Pencil className="size-4" /></Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Eliminar"
                    className="text-danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "¿Eliminar esta ausencia?",
                        description: `${ABSENCE_TYPE_LABEL[r.type]} · ${formatRange(r.startDate, r.endDate)}. Se borrará también su historial.`,
                        confirmLabel: "Eliminar",
                        danger: true,
                      });
                      if (ok) await run(() => deleteAbsenceAction(r.id), { success: "Ausencia eliminada." });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AbsenceFormDialog
        open={form != null}
        onClose={() => setForm(null)}
        rules={rules}
        initial={form ?? { type: "VACATION", status: "REQUESTED", startDate: "2026-01-01", endDate: "2026-01-01", portion: "FULL", daysOverride: null, notes: null }}
      />

      <Dialog open={history != null} onClose={() => setHistory(null)} title="Historial de la ausencia" description={history ? formatRange(history.startDate, history.endDate) : undefined}>
        <ol className="space-y-3">
          {history?.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT[e.toStatus])} />
              <div>
                <p>
                  {e.fromStatus ? `${ABSENCE_STATUS_LABEL[e.fromStatus]} → ` : ""}
                  <span className="font-medium">{ABSENCE_STATUS_LABEL[e.toStatus]}</span>
                  {e.note && <span className="text-ink-soft"> · {e.note}</span>}
                </p>
                <p className="text-xs text-ink-faint">{new Date(e.at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}
