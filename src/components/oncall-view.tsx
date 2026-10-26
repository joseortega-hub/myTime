"use client";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteOnCallAction, saveOnCallAction } from "@/app/actions";
import { diffDays, formatRange, spanDays } from "@/domain/dates";
import { formatMinutes } from "@/domain/hours/schedule";
import {
  ONCALL_COMPENSATION_LABEL,
  ONCALL_COMPENSATIONS,
  ONCALL_KIND_LABEL,
  ONCALL_KINDS,
  ONCALL_STATUS_LABEL,
  ONCALL_STATUSES,
  type OnCallCompensation,
  type OnCallKind,
  type OnCallStatus,
  type OnCallSummary,
} from "@/domain/oncall";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Stat, Textarea, cx, formatDays } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";

interface Shift {
  id: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  kind: OnCallKind;
  status: OnCallStatus;
  workedMinutes: number;
  compensation: OnCallCompensation;
  compensationDays: number | null;
  jiraIssueKey: string | null;
  notes: string | null;
}

const STATUS_TONE: Record<OnCallStatus, "warning" | "success" | "neutral"> = { PLANNED: "warning", DONE: "success", CANCELLED: "neutral" };

export function OnCallView({ year, currentYear, today, shifts, summary }: { year: number; currentYear: number; today: string; shifts: Shift[]; summary: OnCallSummary }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const { run } = useAction();
  const confirm = useConfirm();
  const upcoming = shifts.filter((s) => s.endDate >= today && s.status !== "CANCELLED").sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const past = shifts.filter((s) => !upcoming.includes(s));

  const row = (s: Shift) => {
    const inDays = diffDays(today, s.startDate);
    return (
      <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
        <div className="min-w-48 flex-1">
          <p className={cx("text-sm font-medium", s.status === "CANCELLED" && "text-ink-faint line-through")}>
            {formatRange(s.startDate, s.endDate)}
            {s.startTime && <span className="font-normal text-ink-soft"> · {s.startTime}{s.endTime ? `–${s.endTime}` : ""}</span>}
          </p>
          <p className="text-xs text-ink-soft">
            {ONCALL_KIND_LABEL[s.kind]} · {spanDays(s.startDate, s.endDate)} {spanDays(s.startDate, s.endDate) === 1 ? "día" : "días"}
            {s.workedMinutes > 0 && ` · ${formatMinutes(s.workedMinutes)} de intervención`}
            {s.jiraIssueKey && ` · ${s.jiraIssueKey}`}
            {s.status === "PLANNED" && inDays >= 0 && ` · ${inDays === 0 ? "empieza hoy" : inDays === 1 ? "empieza mañana" : `en ${inDays} días`}`}
          </p>
        </div>
        <Badge tone={s.compensation === "PENDING" ? "warning" : s.compensation === "DAYS" ? "primary" : "neutral"}>
          {ONCALL_COMPENSATION_LABEL[s.compensation]}{s.compensation === "DAYS" && s.compensationDays ? ` (${formatDays(s.compensationDays)})` : ""}
        </Badge>
        <Badge tone={STATUS_TONE[s.status]}>{ONCALL_STATUS_LABEL[s.status]}</Badge>
        <div className="flex">
          <Button size="sm" variant="ghost" aria-label="Editar guardia" onClick={() => setEditing(s)}><Pencil className="size-4" /></Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            aria-label="Eliminar guardia"
            onClick={async () => {
              const ok = await confirm({ title: "¿Eliminar esta guardia?", description: formatRange(s.startDate, s.endDate), confirmLabel: "Eliminar", danger: true });
              if (ok) await run(() => deleteOnCallAction(s.id), { success: "Guardia eliminada." });
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select aria-label="Año" className="w-28" value={year} onChange={(e) => router.push(`/guardias?año=${e.target.value}`)}>
          {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nueva guardia</Button>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-5">
          <Stat label={`Guardias ${year}`} value={summary.shifts} />
          <Stat label="Días de guardia" value={summary.days} />
          <Stat label="Intervención" value={formatMinutes(summary.workedMinutes)} />
          <Stat label="Días compensados" value={formatDays(summary.compensationDays)} tone="primary" />
          <Stat label="Compensación pendiente" value={summary.pendingCompensation} tone={summary.pendingCompensation ? "warning" : "muted"} hint="guardias hechas sin compensar" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Próximas" />
        {upcoming.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-5" />} title="No tienes guardias programadas" description="Añádelas y te avisaré una semana antes y el día anterior." action={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nueva guardia</Button>} />
        ) : (
          <ul className="divide-y divide-line">{upcoming.map(row)}</ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader title="Historial" />
          <ul className="divide-y divide-line">{past.map(row)}</ul>
        </Card>
      )}

      <OnCallDialog target={editing} today={today} onClose={() => setEditing(null)} />
    </div>
  );
}

function OnCallDialog({ target, today, onClose }: { target: Shift | "new" | null; today: string; onClose: () => void }) {
  return (
    <Dialog open={target != null} onClose={onClose} title={target === "new" ? "Nueva guardia" : "Editar guardia"}>
      {target && <OnCallForm key={target === "new" ? "new" : target.id} initial={target === "new" ? null : target} today={today} onDone={onClose} />}
    </Dialog>
  );
}

function OnCallForm({ initial, today, onDone }: { initial: Shift | null; today: string; onDone: () => void }) {
  const [v, setV] = useState({
    startDate: initial?.startDate ?? today,
    endDate: initial?.endDate ?? today,
    startTime: initial?.startTime ?? "",
    endTime: initial?.endTime ?? "",
    kind: initial?.kind ?? ("ON_CALL" as OnCallKind),
    status: initial?.status ?? ("PLANNED" as OnCallStatus),
    worked: initial ? String(initial.workedMinutes / 60).replace(".", ",") : "0",
    compensation: initial?.compensation ?? ("PENDING" as OnCallCompensation),
    compensationDays: initial?.compensationDays != null ? String(initial.compensationDays) : "",
    jiraIssueKey: initial?.jiraIssueKey ?? "",
    notes: initial?.notes ?? "",
  });
  const { run, pending, fieldErrors } = useAction();
  const set = (patch: Partial<typeof v>) => setV((s) => ({ ...s, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      startDate: v.startDate,
      endDate: v.endDate,
      startTime: v.startTime || null,
      endTime: v.endTime || null,
      kind: v.kind,
      status: v.status,
      workedMinutes: Math.round((Number(v.worked.replace(",", ".")) || 0) * 60),
      compensation: v.compensation,
      compensationDays: v.compensationDays ? Number(v.compensationDays.replace(",", ".")) : null,
      jiraIssueKey: v.jiraIssueKey || null,
      notes: v.notes || null,
    };
    const r = await run(() => saveOnCallAction(initial?.id ?? null, input), { success: "Guardia guardada." });
    if (r !== undefined) onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="g-kind">
          <Select id="g-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as OnCallKind })}>
            {ONCALL_KINDS.map((k) => <option key={k} value={k}>{ONCALL_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="g-status">
          <Select id="g-status" value={v.status} onChange={(e) => set({ status: e.target.value as OnCallStatus })}>
            {ONCALL_STATUSES.map((s) => <option key={s} value={s}>{ONCALL_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="g-start" error={fieldErrors.startDate}><Input id="g-start" type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: v.endDate < e.target.value ? e.target.value : v.endDate })} /></Field>
        <Field label="Hasta" htmlFor="g-end" error={fieldErrors.endDate}><Input id="g-end" type="date" min={v.startDate} value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
        <Field label="Hora de inicio (opcional)" htmlFor="g-st"><Input id="g-st" type="time" value={v.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
        <Field label="Hora de fin (opcional)" htmlFor="g-et"><Input id="g-et" type="time" value={v.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        <Field label="Horas de intervención" htmlFor="g-worked" hint="Las que realmente trabajaste durante la guardia."><Input id="g-worked" inputMode="decimal" value={v.worked} onChange={(e) => set({ worked: e.target.value })} /></Field>
        <Field label="Clave Jira (opcional)" htmlFor="g-key" error={fieldErrors.jiraIssueKey}><Input id="g-key" placeholder="GUARD-12" value={v.jiraIssueKey} onChange={(e) => set({ jiraIssueKey: e.target.value })} /></Field>
        <Field label="Compensación" htmlFor="g-comp">
          <Select id="g-comp" value={v.compensation} onChange={(e) => set({ compensation: e.target.value as OnCallCompensation })}>
            {ONCALL_COMPENSATIONS.map((c) => <option key={c} value={c}>{ONCALL_COMPENSATION_LABEL[c]}</option>)}
          </Select>
        </Field>
        {v.compensation === "DAYS" && (
          <Field label="Días compensados que genera" htmlFor="g-days" hint="Regístralos luego en Compensados para elegir fecha.">
            <Input id="g-days" inputMode="decimal" value={v.compensationDays} onChange={(e) => set({ compensationDays: e.target.value })} />
          </Field>
        )}
      </div>
      <Field label="Notas (opcional)" htmlFor="g-notes"><Textarea id="g-notes" rows={2} maxLength={300} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending}>Guardar</Button>
      </div>
    </form>
  );
}
