"use client";
import { Hourglass, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ABSENCE_STATUS_LABEL, ABSENCE_TYPE_LABEL, type AbsenceStatus, type AbsenceType, type DayPortion } from "@/domain/absences";
import { CalendarIndex, type WorkCalendarRules } from "@/domain/calendar";
import { daysInMonth, diffDays, formatDate, isoWeekday, makeIso, monthOf, MONTH_NAMES, WEEKDAY_SHORT, yearOf } from "@/domain/dates";
import { addMonths, dayRequestState, monthDeadline, requestDeadline, type ClosingWindow, type DayRequestState } from "@/domain/deadlines";
import { AbsenceFormDialog, type AbsenceFormValues } from "./absence-form";
import { STATUS_CELL } from "./absence-style";
import { Badge, Card, LinkButton, Notice, cx, formatDays } from "./ui";

export interface MapAbsence {
  id: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
  portion: DayPortion;
}

const STATE_CELL: Record<DayRequestState, string> = {
  past: "bg-canvas text-ink-faint/60",
  closed: "pattern-rejected text-ink-faint",
  closing: "bg-pending-soft text-pending ring-1 ring-inset ring-pending/40",
  open: "bg-primary-soft/70 text-primary-strong",
};

const STATE_LABEL: Record<DayRequestState, string> = {
  past: "Ya pasado",
  closed: "Fuera de plazo",
  closing: "El plazo se cierra pronto",
  open: "En plazo",
};

export function VacationMap(props: {
  today: string;
  start: string;
  months: number;
  leadMonths: number;
  rules: WorkCalendarRules;
  absences: MapAbsence[];
  teamCounts: Record<string, number>;
  closing: ClosingWindow;
  freeDays: number | null;
}) {
  const { today, leadMonths, absences, teamCounts, closing } = props;
  const index = useMemo(() => new CalendarIndex(props.rules), [props.rules]);
  const [form, setForm] = useState<AbsenceFormValues | null>(null);
  const months = Array.from({ length: props.months }, (_, i) => addMonths(props.start, i));
  const absenceOn = (d: string) => absences.find((a) => a.startDate <= d && a.endDate >= d);

  const closingMonth = MONTH_NAMES[closing.month - 1];
  return (
    <div className="space-y-6">
      <Notice
        tone={closing.daysLeft <= 7 ? "danger" : closing.daysLeft <= 14 ? "warning" : "info"}
        title={
          closing.daysLeft === 0
            ? `Hoy es el último día para pedir vacaciones en ${closingMonth}`
            : `Te quedan ${closing.daysLeft} días para pedir vacaciones en ${closingMonth} de ${closing.year}`
        }
      >
        Con {leadMonths} meses de antelación, de {closingMonth} solo puedes pedir ya desde el {formatDate(closing.firstRequestable, "short")}. El plazo para todo el mes termina el{" "}
        {formatDate(closing.lastDeadline, "long")}.
        {props.freeDays != null && props.freeDays > 0 && <> Tienes {formatDays(props.freeDays)} días sin solicitar ni planificar este año.</>}
      </Notice>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        {(["open", "closing", "closed"] as DayRequestState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className={cx("size-3.5 rounded", STATE_CELL[s])} /> {STATE_LABEL[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-holiday-soft ring-1 ring-inset ring-holiday/50" /> Festivo</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-approved-soft" /> Tus ausencias</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded pattern-planned" /> Planificadas</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-team" /> Equipo ausente</span>
        <LinkButton href="/optimizador" size="sm" variant="subtle" className="ml-auto"><Sparkles className="size-4" /> Optimizar</LinkButton>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <caption className="sr-only">Mapa de vacaciones por mes y día, con el estado del plazo para pedirlas</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-36 bg-surface px-3 py-2 text-left text-xs font-medium text-ink-soft">Mes</th>
                {Array.from({ length: 31 }, (_, i) => (
                  <th scope="col" key={i} className="w-7 min-w-7 px-0 py-2 text-center font-normal text-ink-faint tabular touch:min-w-10">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const y = yearOf(m);
                const mo = monthOf(m);
                const deadline = monthDeadline(y, mo, leadMonths);
                const lastDeadline = requestDeadline(makeIso(y, mo, daysInMonth(y, mo)), leadMonths);
                const left = diffDays(today, lastDeadline);
                const status =
                  left < 0 ? { tone: "neutral" as const, text: "Plazo cerrado" } :
                  deadline < today ? { tone: "warning" as const, text: `Cerrándose · ${left} d` } :
                  diffDays(today, deadline) <= 14 ? { tone: "warning" as const, text: `Pide antes del ${formatDate(deadline, "short")}` } :
                  { tone: "success" as const, text: `Pide antes del ${formatDate(deadline, "short")}` };
                return (
                  <tr key={m}>
                    <th scope="row" className="sticky left-0 z-10 border-t border-line bg-surface px-3 py-1.5 text-left align-middle">
                      <span className="block text-xs font-semibold capitalize">{MONTH_NAMES[mo - 1]} {y !== yearOf(today) ? y : ""}</span>
                      <Badge tone={status.tone} className="mt-0.5 !px-1.5 !text-[10px]">{status.text}</Badge>
                    </th>
                    {Array.from({ length: 31 }, (_, i) => {
                      const day = i + 1;
                      if (day > daysInMonth(y, mo)) return <td key={i} className="border-t border-line" />;
                      const d = makeIso(y, mo, day);
                      const cls = index.classify(d);
                      const state = dayRequestState(d, today, leadMonths);
                      const a = absenceOn(d);
                      const team = teamCounts[d] ?? 0;
                      const label = [
                        formatDate(d, "long"),
                        cls.holiday ? `Festivo: ${cls.holiday.name}` : cls.kind === "non_working" ? "No laborable" : null,
                        a ? `${ABSENCE_TYPE_LABEL[a.type]} (${ABSENCE_STATUS_LABEL[a.status].toLowerCase()})` : null,
                        cls.kind === "working" && state !== "past" ? `${STATE_LABEL[state]} · pedir antes del ${formatDate(requestDeadline(d, leadMonths))}` : null,
                        team ? `${team} compañeros ausentes` : null,
                      ].filter(Boolean).join(". ");
                      const canAdd = state !== "past" && !a;
                      return (
                        <td key={i} className="border-t border-line p-0.5">
                          <button
                            type="button"
                            title={label}
                            aria-label={label}
                            disabled={!canAdd}
                            onClick={() => setForm({ type: "VACATION", status: state === "closed" ? "PLANNED" : "REQUESTED", startDate: d, endDate: d, portion: "FULL", daysOverride: null, notes: null })}
                            className={cx(
                              "relative grid h-8 w-full place-items-center rounded tabular touch:h-11 transition-transform enabled:hover:scale-110 enabled:hover:shadow",
                              a ? STATUS_CELL[a.status] : cls.holiday ? "bg-holiday-soft font-semibold text-holiday ring-1 ring-inset ring-holiday/40" : cls.kind === "non_working" ? "bg-weekend text-ink-faint" : STATE_CELL[state],
                              d === today && "outline-2 outline-ink",
                            )}
                          >
                            <span aria-hidden>{WEEKDAY_SHORT[isoWeekday(d) - 1]}</span>
                            {team > 0 && <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-team" aria-hidden />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="flex items-start gap-2 text-xs text-ink-soft">
        <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Pulsa un día libre para registrar una solicitud. Si ya está fuera de plazo se crea como «Planificada» para que la consultes con tu responsable. Puedes cambiar los meses de antelación en{" "}
        <Link href="/alertas" className="underline">Alertas → Reglas</Link>.
      </p>

      <AbsenceFormDialog
        open={form != null}
        onClose={() => setForm(null)}
        rules={props.rules}
        initial={form ?? { type: "VACATION", status: "REQUESTED", startDate: today, endDate: today, portion: "FULL", daysOverride: null, notes: null }}
      />
    </div>
  );
}
