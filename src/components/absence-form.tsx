"use client";
import { useMemo, useState } from "react";
import { createAbsenceAction, updateAbsenceAction } from "@/app/actions";
import {
  ABSENCE_STATUS_LABEL,
  ABSENCE_STATUSES,
  ABSENCE_TYPE_LABEL,
  ABSENCE_TYPES,
  computeConsumption,
  DAY_PORTION_LABEL,
  DAY_PORTIONS,
  type AbsenceStatus,
  type AbsenceType,
  type DayPortion,
} from "@/domain/absences";
import { CalendarIndex, type WorkCalendarRules } from "@/domain/calendar";
import { isIsoDate, spanDays } from "@/domain/dates";
import { Button, Field, Input, Select, Textarea, formatDays } from "./ui";
import { Dialog, useAction } from "./ui-client";

export interface AbsenceFormValues {
  id?: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
  portion: DayPortion;
  daysOverride: number | null;
  notes: string | null;
}

export function AbsenceFormDialog({
  open,
  onClose,
  initial,
  rules,
}: {
  open: boolean;
  onClose: () => void;
  initial: AbsenceFormValues;
  rules: WorkCalendarRules;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={initial.id ? "Editar ausencia" : "Nueva ausencia"} description="Solo se guarda en MyTime; no se envía nada a Jira.">
      {open && <AbsenceForm key={initial.id ?? initial.startDate} initial={initial} rules={rules} onDone={onClose} />}
    </Dialog>
  );
}

function AbsenceForm({ initial, rules, onDone }: { initial: AbsenceFormValues; rules: WorkCalendarRules; onDone: () => void }) {
  const [v, setV] = useState(initial);
  const [overrideText, setOverrideText] = useState(initial.daysOverride != null ? String(initial.daysOverride) : "");
  const { run, pending, fieldErrors } = useAction();
  const index = useMemo(() => new CalendarIndex(rules), [rules]);

  const set = <K extends keyof AbsenceFormValues>(k: K, value: AbsenceFormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const validRange = isIsoDate(v.startDate) && isIsoDate(v.endDate) && v.startDate <= v.endDate;
  const computed = validRange && spanDays(v.startDate, v.endDate) <= 366
    ? computeConsumption({ id: "x", ...v, portion: v.startDate === v.endDate ? v.portion : "FULL", daysOverride: null }, index)
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const override = overrideText.trim() === "" ? null : Number(overrideText.replace(",", "."));
    const payload = (allowOverlap: boolean) => ({
      ...v,
      portion: v.startDate === v.endDate ? v.portion : "FULL",
      daysOverride: override,
      allowOverlap,
    });
    const res = await run(
      (confirmed) => (v.id ? updateAbsenceAction(v.id, payload(confirmed)) : createAbsenceAction(payload(confirmed))),
      { success: v.id ? "Ausencia actualizada." : "Ausencia guardada." },
    );
    if (res !== undefined) onDone();
  };

  const err = (k: string) => fieldErrors[k];

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="abs-type">
          <Select id="abs-type" value={v.type} onChange={(e) => set("type", e.target.value as AbsenceType)}>
            {ABSENCE_TYPES.map((t) => <option key={t} value={t}>{ABSENCE_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="abs-status" hint="Solo descuentan las aprobadas y disfrutadas.">
          <Select id="abs-status" value={v.status} onChange={(e) => set("status", e.target.value as AbsenceStatus)}>
            {ABSENCE_STATUSES.map((s) => <option key={s} value={s}>{ABSENCE_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="abs-start" error={err("startDate")}>
          <Input
            id="abs-start"
            type="date"
            required
            value={v.startDate}
            aria-invalid={Boolean(err("startDate"))}
            onChange={(e) => {
              const s = e.target.value;
              setV((cur) => ({ ...cur, startDate: s, endDate: cur.endDate < s ? s : cur.endDate }));
            }}
          />
        </Field>
        <Field label="Hasta" htmlFor="abs-end" error={err("endDate")}>
          <Input id="abs-end" type="date" required min={v.startDate} value={v.endDate} aria-invalid={Boolean(err("endDate"))} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
        {v.startDate === v.endDate && (
          <Field label="Jornada" htmlFor="abs-portion" error={err("portion")}>
            <Select id="abs-portion" value={v.portion} onChange={(e) => set("portion", e.target.value as DayPortion)}>
              {DAY_PORTIONS.map((p) => <option key={p} value={p}>{DAY_PORTION_LABEL[p]}</option>)}
            </Select>
          </Field>
        )}
        <Field
          label="Días que consume (opcional)"
          htmlFor="abs-override"
          error={err("daysOverride")}
          hint="Déjalo vacío para calcularlo con tu calendario."
        >
          <Input id="abs-override" inputMode="decimal" placeholder={computed ? formatDays(computed.total) : ""} value={overrideText} onChange={(e) => setOverrideText(e.target.value)} />
        </Field>
      </div>

      <div className="rounded-xl bg-canvas px-4 py-3 text-sm" aria-live="polite">
        {computed ? (
          <p>
            <span className="font-semibold tabular">{formatDays(computed.total)}</span> {computed.total === 1 ? "día laborable" : "días laborables"} en{" "}
            {spanDays(v.startDate, v.endDate)} {spanDays(v.startDate, v.endDate) === 1 ? "día natural" : "días naturales"}
            {computed.byYear.size > 1 && (
              <span className="text-ink-soft"> · {[...computed.byYear].map(([y, d]) => `${formatDays(d)} en ${y}`).join(", ")}</span>
            )}
          </p>
        ) : (
          <p className="text-ink-soft">Indica un periodo válido para ver los días que consume.</p>
        )}
      </div>

      <Field label="Notas (opcional)" htmlFor="abs-notes" hint="Solo las ves tú.">
        <Textarea id="abs-notes" rows={2} maxLength={500} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending || !validRange}>{pending ? "Guardando…" : "Guardar"}</Button>
      </div>
    </form>
  );
}
