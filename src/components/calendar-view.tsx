"use client";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { changeAbsenceStatusAction, deleteAbsenceAction } from "@/app/actions";
import {
  ABSENCE_STATUS_LABEL,
  ABSENCE_TYPE_LABEL,
  allowedTransitions,
  DAY_PORTION_LABEL,
  type AbsenceStatus,
  type AbsenceType,
  type DayPortion,
} from "@/domain/absences";
import { CalendarIndex, HOLIDAY_SCOPE_LABEL, summarizePeriod, type WorkCalendarRules } from "@/domain/calendar";
import { formatDate, formatRange, isIsoDate, MONTH_NAMES, monthGrid, WEEKDAY_SHORT } from "@/domain/dates";
import { ONCALL_KIND_LABEL, type OnCallKind } from "@/domain/oncall";
import { AbsenceFormDialog, type AbsenceFormValues } from "./absence-form";
import { STATUS_CELL, STATUS_DOT, STATUS_TONE, TYPE_BG, TYPE_BORDER, TYPE_SHORT, TypeLegend } from "./absence-style";
import { Badge, Button, Card, DemoBadge, Field, Input, Notice, SegmentedLinks, cx, formatDays } from "./ui";
import { useAction, useConfirm } from "./ui-client";

export interface CalendarAbsence {
  id: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
  portion: DayPortion;
  daysOverride: number | null;
  notes: string | null;
  origin: string;
}

type FilterKey = "holidays" | "approved" | "pending" | "rejected" | "planned" | "team";
const FILTERS: { key: FilterKey; label: string; swatch: string }[] = [
  { key: "holidays", label: "Festivos", swatch: "bg-holiday-soft ring-1 ring-holiday/40" },
  { key: "approved", label: "Aprobadas / disfrutadas", swatch: "bg-approved-soft ring-1 ring-approved/40" },
  { key: "pending", label: "Pendientes", swatch: "bg-pending-soft ring-1 ring-pending/50" },
  { key: "planned", label: "Planificadas", swatch: "pattern-planned" },
  { key: "rejected", label: "Rechazadas / canceladas", swatch: "pattern-rejected" },
  { key: "team", label: "Ausencias del equipo", swatch: "bg-team" },
];

function statusFilter(s: AbsenceStatus): FilterKey {
  if (s === "APPROVED" || s === "TAKEN") return "approved";
  if (s === "REQUESTED") return "pending";
  if (s === "PLANNED") return "planned";
  return "rejected";
}

export function CalendarView(props: {
  year: number;
  month: number;
  view: "month" | "year";
  today: string;
  rules: WorkCalendarRules;
  absences: CalendarAbsence[];
  onCall: { id: string; startDate: string; endDate: string; kind: OnCallKind }[];
  teamCounts: Record<string, number>;
  teamSize: number;
  hasDemoTeam: boolean;
  complete: boolean;
}) {
  const { year, month, view, today, rules, absences, teamCounts } = props;
  const index = useMemo(() => new CalendarIndex(rules), [rules]);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({ holidays: true, approved: true, pending: true, planned: true, rejected: false, team: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<AbsenceFormValues | null>(null);

  const visible = absences.filter((a) => filters[statusFilter(a.status)]);
  const absencesOn = (d: string) => visible.filter((a) => a.startDate <= d && a.endDate >= d);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const href = (y: number, m: number, v = view) => `/calendario?año=${y}&mes=${m}${v === "year" ? "&vista=año" : ""}`;

  const openNew = (date: string) =>
    setForm({ type: "VACATION", status: "REQUESTED", startDate: date, endDate: date, portion: "FULL", daysOverride: null, notes: null });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full items-center gap-1 sm:w-auto">
            <Link
              href={view === "year" ? href(year - 1, month) : href(prev.y, prev.m)}
              className="grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-hover active:bg-hover touch:size-11"
              aria-label={view === "year" ? "Año anterior" : "Mes anterior"}
            >
              <ChevronLeft className="size-5" />
            </Link>
            <h2 className="min-w-0 flex-1 text-center text-lg font-semibold capitalize sm:min-w-44 sm:flex-none" aria-live="polite">
              {view === "year" ? year : `${MONTH_NAMES[month - 1]} ${year}`}
            </h2>
            <Link
              href={view === "year" ? href(year + 1, month) : href(next.y, next.m)}
              className="grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-hover active:bg-hover touch:size-11"
              aria-label={view === "year" ? "Año siguiente" : "Mes siguiente"}
            >
              <ChevronRight className="size-5" />
            </Link>
            <Link href={`/calendario?año=${today.slice(0, 4)}&mes=${Number(today.slice(5, 7))}${view === "year" ? "&vista=año" : ""}`} className="ml-1 inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft touch:min-h-11">
              Hoy
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedLinks
              label="Vista"
              items={[
                { href: href(year, month, "month"), label: "Mes", active: view === "month" },
                { href: href(year, month, "year"), label: "Año", active: view === "year" },
              ]}
            />
            <Button onClick={() => openNew(selected ?? today)}>
              <Plus className="size-4" aria-hidden /> Ausencia
            </Button>
          </div>
        </div>

        {!props.complete && (
          <Notice tone="warning">
            El calendario de {year} está incompleto: los festivos no están confirmados.{" "}
            <Link href="/ajustes#calendario" className="font-medium underline">Revisar festivos</Link>
          </Notice>
        )}

        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <legend className="sr-only">Filtrar eventos</legend>
          {FILTERS.map((f) => (
            <label key={f.key} className="inline-flex cursor-pointer items-center gap-2 text-ink-soft">
              <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={filters[f.key]} onChange={(e) => setFilters((s) => ({ ...s, [f.key]: e.target.checked }))} />
              <span className={cx("size-3 rounded-sm", f.swatch)} aria-hidden />
              {f.label}
              {f.key === "team" && props.hasDemoTeam && <DemoBadge />}
            </label>
          ))}
        </fieldset>
        <TypeLegend />

        {view === "month" ? (
          <Card className="overflow-hidden max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0">
            <div role="grid" aria-label={`Calendario de ${MONTH_NAMES[month - 1]} ${year}`}>
              <div role="row" className="grid grid-cols-7 border-b border-line bg-canvas/60 text-center text-xs font-medium text-ink-soft">
                {WEEKDAY_SHORT.map((d) => <div role="columnheader" key={d} className="py-2">{d}</div>)}
              </div>
              {monthGrid(year, month).map((week, wi) => (
                <div role="row" key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
                  {week.map(({ date, outside }) => {
                    const cls = index.classify(date);
                    const showHoliday = filters.holidays && cls.holiday;
                    const dayAbs = absencesOn(date);
                    const team = filters.team ? (teamCounts[date] ?? 0) : 0;
                    const isSel = selected === date;
                    return (
                      <button
                        role="gridcell"
                        type="button"
                        key={date}
                        onClick={() => setSelected(date)}
                        onDoubleClick={() => openNew(date)}
                        aria-selected={isSel}
                        aria-label={`${formatDate(date, "long")}${cls.holiday ? `, festivo: ${cls.holiday.name}` : ""}${dayAbs.length ? `, ${dayAbs.length} ausencia(s)` : ""}${team ? `, ${team} compañeros ausentes` : ""}`}
                        className={cx(
                          "relative flex min-h-20 flex-col items-stretch gap-1 border-r border-line p-1.5 text-left last:border-r-0 sm:min-h-24",
                          cls.kind === "non_working" && "bg-weekend",
                          showHoliday && "bg-holiday-soft",
                          outside && "opacity-40",
                          isSel && "ring-2 ring-inset ring-primary",
                        )}
                      >
                        <span className={cx("tabular inline-grid size-6 place-items-center rounded-full text-xs font-medium", date === today && "bg-primary text-primary-ink", showHoliday && date !== today && "text-holiday")}>
                          {Number(date.slice(8))}
                        </span>
                        {showHoliday && <span className="truncate text-[10px] leading-tight font-medium text-holiday">{cls.holiday!.name}</span>}
                        {dayAbs.slice(0, 2).map((a) => (
                          <span key={a.id} title={`${ABSENCE_TYPE_LABEL[a.type]} · ${ABSENCE_STATUS_LABEL[a.status]}`} className={cx("truncate rounded border-l-[3px] px-1 text-[10px] leading-4 font-medium", STATUS_CELL[a.status], TYPE_BORDER[a.type])}>
                            <span className="sm:hidden">{TYPE_SHORT[a.type]}</span>
                            <span className="max-sm:hidden">{ABSENCE_TYPE_LABEL[a.type]}</span> · {ABSENCE_STATUS_LABEL[a.status]}
                            {a.portion !== "FULL" && " ½"}
                          </span>
                        ))}
                        {dayAbs.length > 2 && <span className="text-[10px] text-ink-faint">+{dayAbs.length - 2}</span>}
                        {props.onCall.filter((g) => g.startDate <= date && g.endDate >= date).slice(0, 1).map((g) => (
                          <span key={g.id} className="truncate rounded bg-info-soft px-1 text-[10px] leading-4 font-medium text-info">Guardia · {ONCALL_KIND_LABEL[g.kind].toLowerCase()}</span>
                        ))}
                        {team > 0 && (
                          <span className="mt-auto inline-flex items-center gap-1 text-[10px] font-medium text-team" title={`${team} compañeros ausentes`}>
                            {Array.from({ length: Math.min(team, 4) }).map((_, i) => <span key={i} className="size-1.5 rounded-full bg-team" />)}
                            {team > 4 && `+${team - 4}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <Card key={m} className="p-3">
                <Link href={href(year, m, "month")} className="mb-2 block text-sm font-semibold capitalize hover:text-primary">
                  {MONTH_NAMES[m - 1]}
                </Link>
                <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-faint">
                  {WEEKDAY_SHORT.map((d) => <span key={d}>{d}</span>)}
                </div>
                {monthGrid(year, m).map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-0.5">
                    {week.map(({ date, outside }) => {
                      if (outside) return <span key={date} />;
                      const cls = index.classify(date);
                      const a = absencesOn(date)[0];
                      const team = filters.team ? (teamCounts[date] ?? 0) : 0;
                      return (
                        <button
                          type="button"
                          key={date}
                          onClick={() => setSelected(date)}
                          aria-label={`${formatDate(date, "long")}${a ? `, ${ABSENCE_TYPE_LABEL[a.type].toLowerCase()} (${ABSENCE_STATUS_LABEL[a.status].toLowerCase()})` : ""}`}
                          title={a ? `${ABSENCE_TYPE_LABEL[a.type]} · ${ABSENCE_STATUS_LABEL[a.status]}` : undefined}
                          className={cx(
                            "tabular relative grid aspect-square place-items-center rounded text-[11px]",
                            cls.kind === "non_working" && "bg-weekend text-ink-faint",
                            filters.holidays && cls.holiday && "bg-holiday-soft font-semibold text-holiday",
                            a && STATUS_CELL[a.status],
                            date === today && "ring-2 ring-primary",
                            selected === date && "outline-2 outline-ink",
                          )}
                        >
                          {Number(date.slice(8))}
                          {a && <span className={cx("absolute inset-x-0.5 top-0.5 h-1 rounded-full", TYPE_BG[a.type])} aria-hidden />}
                          {team > 0 && <span className="absolute right-0.5 bottom-0.5 size-1 rounded-full bg-team" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <DayDetail
          date={selected}
          index={index}
          absences={absences.filter((a) => selected && a.startDate <= selected && a.endDate >= selected)}
          team={selected ? (teamCounts[selected] ?? 0) : 0}
          teamSize={props.teamSize}
          onCall={props.onCall.filter((g) => selected && g.startDate <= selected && g.endDate >= selected)}
          onNew={openNew}
          onEdit={(a) => setForm({ ...a })}
        />
        <PeriodCalculator rules={rules} defaultStart={selected ?? today} />
      </aside>

      <AbsenceFormDialog open={form != null} onClose={() => setForm(null)} initial={form ?? { type: "VACATION", status: "REQUESTED", startDate: today, endDate: today, portion: "FULL", daysOverride: null, notes: null }} rules={rules} />
    </div>
  );
}

function DayDetail({
  date, index, absences, team, teamSize, onNew, onEdit, onCall,
}: {
  onCall: { id: string; kind: OnCallKind }[];
  date: string | null;
  index: CalendarIndex;
  absences: CalendarAbsence[];
  team: number;
  teamSize: number;
  onNew: (d: string) => void;
  onEdit: (a: CalendarAbsence) => void;
}) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  if (!date) {
    return (
      <Card className="p-5 text-sm text-ink-soft">
        Selecciona un día para ver su detalle. Doble clic para crear una ausencia.
      </Card>
    );
  }
  const cls = index.classify(date);
  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <p className="text-xs font-medium text-ink-soft uppercase">Detalle del día</p>
        <p className="mt-0.5 font-semibold first-letter:uppercase">{formatDate(date, "long")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cls.kind === "working" && <Badge tone="primary">Laborable</Badge>}
          {cls.kind === "non_working" && <Badge>No laborable</Badge>}
          {cls.holiday && <Badge tone="holiday">Festivo {HOLIDAY_SCOPE_LABEL[cls.holiday.scope].toLowerCase()}: {cls.holiday.name}</Badge>}
          {teamSize > 0 && <Badge tone="info">{team} de {teamSize} compañeros ausentes</Badge>}
          {onCall.map((g) => <Badge key={g.id} tone="info">Guardia {ONCALL_KIND_LABEL[g.kind].toLowerCase()}</Badge>)}
        </div>
      </div>
      <div className="space-y-3 p-5">
        {absences.length === 0 && <p className="text-sm text-ink-soft">Sin ausencias propias este día.</p>}
        {absences.map((a) => (
          <div key={a.id} className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <span className={cx("size-2.5 rounded-full", TYPE_BG[a.type])} aria-hidden />
                  {ABSENCE_TYPE_LABEL[a.type]}
                </p>
                <p className="text-xs text-ink-soft">
                  {formatRange(a.startDate, a.endDate)}
                  {a.portion !== "FULL" && ` · ${DAY_PORTION_LABEL[a.portion]}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[a.status]}>
                <span className={cx("size-1.5 rounded-full", STATUS_DOT[a.status])} />
                {ABSENCE_STATUS_LABEL[a.status]}
              </Badge>
            </div>
            {a.notes && <p className="mt-2 text-xs text-ink-soft">{a.notes}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor={`st-${a.id}`}>Cambiar estado</label>
              <select
                id={`st-${a.id}`}
                disabled={pending}
                className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs touch:h-11 touch:text-sm"
                value=""
                onChange={(e) => {
                  const s = e.target.value as AbsenceStatus;
                  if (s) void run(() => changeAbsenceStatusAction(a.id, s), { success: `Marcada como ${ABSENCE_STATUS_LABEL[s].toLowerCase()}.` });
                }}
              >
                <option value="">Marcar como…</option>
                {allowedTransitions(a.status).map((s) => <option key={s} value={s}>{ABSENCE_STATUS_LABEL[s]}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={() => onEdit(a)} aria-label="Editar">
                <Pencil className="size-3.5" /> Editar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  const ok = await confirm({ title: "¿Eliminar esta ausencia?", description: `${ABSENCE_TYPE_LABEL[a.type]} · ${formatRange(a.startDate, a.endDate)}. Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true });
                  if (ok) await run(() => deleteAbsenceAction(a.id), { success: "Ausencia eliminada." });
                }}
              >
                <Trash2 className="size-3.5" /> Eliminar
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" className="w-full" onClick={() => onNew(date)}>
          <Plus className="size-4" /> Nueva ausencia este día
        </Button>
      </div>
    </Card>
  );
}

function PeriodCalculator({ rules, defaultStart }: { rules: WorkCalendarRules; defaultStart: string }) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultStart);
  const valid = isIsoDate(start) && isIsoDate(end) && start <= end && end.slice(0, 4) <= String(Number(start.slice(0, 4)) + 2);
  const s = valid ? summarizePeriod(start, end, rules) : null;
  return (
    <Card className="p-5">
      <p className="font-semibold">Días laborables de un periodo</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Desde" htmlFor="calc-start"><Input id="calc-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Hasta" htmlFor="calc-end"><Input id="calc-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="mt-3 text-sm" aria-live="polite">
        {s ? (
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-ink-soft">Laborables</dt><dd className="text-right font-semibold tabular">{formatDays(s.workingDays)}</dd>
            <dt className="text-ink-soft">Naturales</dt><dd className="text-right tabular">{s.naturalDays}</dd>
            <dt className="text-ink-soft">No laborables</dt><dd className="text-right tabular">{s.nonWorkingDays}</dd>
            <dt className="text-ink-soft">Festivos en laborable</dt><dd className="text-right tabular">{s.holidaysOnWorkingDays}</dd>
          </dl>
        ) : (
          <p className="text-ink-soft">Indica un periodo válido (máximo dos años).</p>
        )}
      </div>
    </Card>
  );
}
