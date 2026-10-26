/**
 * Centro de alertas: reglas deterministas basadas en fechas.
 *
 * Las alertas se calculan al abrir la aplicación. Las marcadas como
 * `push: true` son recordatorios puntuales que, además, el programador de
 * avisos (ver /api/cron/reminders) puede enviar al móvil una sola vez.
 */
import { ABSENCE_TYPE_LABEL, ACTIVE_STATUSES, type AbsenceRecord } from "./absences";
import type { BalanceSummary } from "./balance";
import type { HolidayInfo } from "./calendar";
import { diffDays, formatDate, formatRange, isoWeekday, MONTH_NAMES, startOfWeek, yearOf, type IsoDate } from "./dates";
import { closingWindow, DEFAULT_LEAD_MONTHS, requestDeadline } from "./deadlines";
import { formatMinutes } from "./hours/schedule";
import { ONCALL_KIND_LABEL, type OnCallKind } from "./oncall";
import type { OverlapAlert } from "./team";

export interface AlertRules {
  upcomingAbsenceDays: number;
  /** Días de antelación de los recordatorios de festivos, compensados y guardias. */
  reminderOffsets: number[];
  pendingRequestDays: number;
  /** Meses de antelación con los que hay que pedir las vacaciones. */
  vacationLeadMonths: number;
  /** Mes (1-12) a partir del cual avisar de días sin planificar. */
  yearEndFromMonth: number;
  teamOverlap: boolean;
  missingHours: boolean;
  /** Recordatorio de jueves y viernes: todo imputado en Jira antes del viernes. */
  weeklyJiraClose: boolean;
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  upcomingAbsenceDays: 14,
  reminderOffsets: [7, 1],
  pendingRequestDays: 7,
  vacationLeadMonths: DEFAULT_LEAD_MONTHS,
  yearEndFromMonth: 10,
  teamOverlap: true,
  missingHours: true,
  weeklyJiraClose: true,
};

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertKind =
  | "upcoming_absence"
  | "upcoming_holiday"
  | "upcoming_compensatory"
  | "upcoming_oncall"
  | "pending_request"
  | "request_deadline"
  | "planned_deadline"
  | "unplanned_days"
  | "team_overlap"
  | "missing_hours"
  | "weekly_jira"
  | "calendar_incomplete";

export interface AppAlert {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  description: string;
  date?: IsoDate;
  href: string;
  /** Recordatorio puntual que puede enviarse como notificación al móvil. */
  push?: boolean;
}

export interface WeekStatus {
  expectedMinutes: number;
  loggedMinutes: number;
  unsyncedEntries: number;
  jiraWriteEnabled: boolean;
}

export interface OnCallReminder {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
  kind: OnCallKind;
  startTime: string | null;
}

export interface AlertInput {
  today: IsoDate;
  rules: AlertRules;
  absences: (AbsenceRecord & { notes?: string | null })[];
  holidays: HolidayInfo[];
  vacationBalance: BalanceSummary | null;
  teamOverlaps: OverlapAlert[];
  calendarComplete: boolean;
  /** Días laborables pasados sin horas registradas (módulo de horas). */
  daysMissingHours: IsoDate[];
  onCall?: OnCallReminder[];
  week?: WeekStatus | null;
}

/** Etapa de recordatorio: la menor antelación configurada que ya se ha alcanzado. */
export function reminderStage(daysUntil: number, offsets: number[]): number | null {
  if (daysUntil < 0) return null;
  const sorted = [...offsets].filter((o) => o >= 0).sort((a, b) => a - b);
  return sorted.find((o) => daysUntil <= o) ?? null;
}

function whenText(days: number): string {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return `en ${days} días`;
}

export function generateAlerts(input: AlertInput): AppAlert[] {
  const { today, rules } = input;
  const out: AppAlert[] = [];

  for (const a of input.absences) {
    const inDays = diffDays(today, a.startDate);

    // Días compensados: recordatorio una semana antes y un día antes.
    if (a.type === "COMPENSATORY" && ACTIVE_STATUSES.has(a.status)) {
      const stage = reminderStage(inDays, rules.reminderOffsets);
      if (stage != null) {
        out.push({
          key: `comp:${a.id}:${a.startDate}:${stage}`,
          kind: "upcoming_compensatory",
          severity: stage <= 1 ? "warning" : "info",
          title: `Día compensado ${whenText(inDays)}`,
          description: `${formatRange(a.startDate, a.endDate)}${a.status === "PLANNED" ? " · aún no solicitado" : a.status === "REQUESTED" ? " · pendiente de aprobación" : ""}`,
          date: a.startDate,
          href: "/compensados",
          push: true,
        });
      }
    } else if ((a.status === "APPROVED" || a.status === "PLANNED") && a.startDate >= today && inDays <= rules.upcomingAbsenceDays) {
      out.push({
        key: `absence:${a.id}:${a.startDate}`,
        kind: "upcoming_absence",
        severity: "info",
        title: inDays === 0 ? `${ABSENCE_TYPE_LABEL[a.type]} desde hoy` : `${ABSENCE_TYPE_LABEL[a.type]} ${whenText(inDays)}`,
        description: `${formatRange(a.startDate, a.endDate)}${a.status === "PLANNED" ? " · aún solo planificada, no solicitada" : ""}`,
        date: a.startDate,
        href: "/ausencias",
      });
    }

    if (a.status === "REQUESTED" && inDays <= rules.pendingRequestDays) {
      out.push({
        key: `pending:${a.id}:${a.startDate}`,
        kind: "pending_request",
        severity: inDays < 0 ? "critical" : "warning",
        title: inDays < 0 ? "Solicitud pendiente con fecha ya iniciada" : "Solicitud pendiente de aprobación",
        description: `${ABSENCE_TYPE_LABEL[a.type]} · ${formatRange(a.startDate, a.endDate)}. Actualiza su estado cuando la aprueben o rechacen.`,
        date: a.startDate,
        href: "/ausencias?estado=REQUESTED",
      });
    }

    // Vacaciones planificadas que hay que pedir con antelación.
    if (a.type === "VACATION" && a.status === "PLANNED" && a.startDate >= today) {
      const deadline = requestDeadline(a.startDate, rules.vacationLeadMonths);
      const left = diffDays(today, deadline);
      if (left <= 14) {
        out.push({
          key: `planned-deadline:${a.id}:${left < 0 ? "late" : left <= 3 ? "3" : "14"}`,
          kind: "planned_deadline",
          severity: left < 0 ? "critical" : "warning",
          title: left < 0 ? "Vacaciones planificadas fuera de plazo" : `Pide ya tus vacaciones del ${formatDate(a.startDate, "short")}`,
          description:
            left < 0
              ? `${formatRange(a.startDate, a.endDate)}: el plazo de ${rules.vacationLeadMonths} meses venció el ${formatDate(deadline)}. Consulta si aún se pueden solicitar.`
              : `${formatRange(a.startDate, a.endDate)}: el plazo para pedirlas termina el ${formatDate(deadline)} (${whenText(left)}).`,
          date: deadline,
          href: "/ausencias?estado=PLANNED",
          push: true,
        });
      }
    }
  }

  // Festivos: recordatorio una semana antes y un día antes.
  for (const h of input.holidays) {
    const inDays = diffDays(today, h.date);
    const stage = reminderStage(inDays, rules.reminderOffsets);
    if (stage == null) continue;
    out.push({
      key: `holiday:${h.date}:${stage}`,
      kind: "upcoming_holiday",
      severity: "info",
      title: inDays === 0 ? `Hoy es festivo: ${h.name}` : `Festivo ${whenText(inDays)}: ${h.name}`,
      description: formatDate(h.date, "long"),
      date: h.date,
      href: "/calendario",
      push: true,
    });
  }

  // Guardias.
  for (const g of input.onCall ?? []) {
    const inDays = diffDays(today, g.startDate);
    const stage = reminderStage(inDays, rules.reminderOffsets);
    if (stage == null) continue;
    out.push({
      key: `oncall:${g.id}:${g.startDate}:${stage}`,
      kind: "upcoming_oncall",
      severity: stage <= 1 ? "warning" : "info",
      title: `Guardia ${whenText(inDays)}`,
      description: `${ONCALL_KIND_LABEL[g.kind]} · ${formatRange(g.startDate, g.endDate)}${g.startTime ? ` desde las ${g.startTime}` : ""}`,
      date: g.startDate,
      href: "/guardias",
      push: true,
    });
  }

  // Plazo de antelación: "te quedas sin tiempo si quieres vacaciones en este mes".
  const w = closingWindow(today, rules.vacationLeadMonths);
  if (w.daysLeft <= 31) {
    const monthName = MONTH_NAMES[w.month - 1];
    const bucket = w.daysLeft <= 1 ? "1" : w.daysLeft <= 7 ? "7" : w.daysLeft <= 14 ? "14" : "31";
    out.push({
      key: `deadline:${w.year}-${w.month}:${bucket}`,
      kind: "request_deadline",
      severity: w.daysLeft <= 7 ? "critical" : w.daysLeft <= 14 ? "warning" : "info",
      title: w.daysLeft === 0 ? `Último día para pedir vacaciones en ${monthName}` : `Te quedas sin tiempo para pedir vacaciones en ${monthName}`,
      description: `Con ${rules.vacationLeadMonths} meses de antelación, de ${monthName} de ${w.year} solo puedes pedir ya desde el ${formatDate(w.firstRequestable, "short")}, y el plazo termina el ${formatDate(w.lastDeadline)} (${whenText(w.daysLeft)}).`,
      date: w.lastDeadline,
      href: "/vacaciones",
      push: w.daysLeft <= 7,
    });
  }

  // Cierre semanal: todo imputado en Jira antes del viernes (aviso jueves y viernes).
  const weekday = isoWeekday(today);
  if (rules.weeklyJiraClose && input.week && (weekday === 4 || weekday === 5)) {
    const wk = input.week;
    const missing = Math.max(0, wk.expectedMinutes - wk.loggedMinutes);
    const parts = [`Llevas ${formatMinutes(wk.loggedMinutes)} de ${formatMinutes(wk.expectedMinutes)} esta semana`];
    if (missing > 0) parts.push(`faltan ${formatMinutes(missing)}`);
    if (wk.unsyncedEntries > 0) parts.push(`${wk.unsyncedEntries} ${wk.unsyncedEntries === 1 ? "registro sin imputar" : "registros sin imputar"} en Jira`);
    out.push({
      key: `weekly:${startOfWeek(today)}:${weekday}`,
      kind: "weekly_jira",
      severity: weekday === 5 ? "critical" : "warning",
      title: weekday === 5 ? "Hoy es viernes: deja todo imputado en Jira" : "Mañana es viernes: revisa tus imputaciones en Jira",
      description: `${parts.join(" · ")}.`,
      date: today,
      href: `/horas?semana=${startOfWeek(today)}`,
      push: true,
    });
  }

  const b = input.vacationBalance;
  const month = Number(today.slice(5, 7));
  if (b && b.available != null && month >= rules.yearEndFromMonth) {
    const unplanned = b.available - b.requested - b.planned;
    if (unplanned > 0) {
      out.push({
        key: `unplanned:${yearOf(today)}:${unplanned}`,
        kind: "unplanned_days",
        severity: month >= 12 ? "critical" : "warning",
        title: `Tienes ${unplanned} ${unplanned === 1 ? "día" : "días"} de vacaciones sin planificar`,
        description: "Se acerca el final del año. El optimizador puede sugerirte las mejores fechas.",
        href: "/optimizador",
      });
    }
  }

  if (rules.teamOverlap) {
    for (const o of input.teamOverlaps) {
      if (o.end < today) continue;
      out.push({
        key: `team:${o.start}:${o.end}:${o.level}`,
        kind: "team_overlap",
        severity: o.level,
        title: o.level === "critical" ? "Cobertura del equipo por debajo del mínimo" : "Muchas ausencias simultáneas en el equipo",
        description: `${formatRange(o.start, o.end)} · hasta ${o.maxAbsent} ${o.maxAbsent === 1 ? "persona ausente" : "personas ausentes"}.`,
        date: o.start,
        href: "/equipo",
      });
    }
  }

  if (!input.calendarComplete) {
    out.push({
      key: `calendar:${yearOf(today)}`,
      kind: "calendar_incomplete",
      severity: "warning",
      title: `Calendario laboral de ${yearOf(today)} sin confirmar`,
      description: "Añade o importa los festivos oficiales y márcalos como completos para que los cálculos sean exactos.",
      href: "/ajustes#calendario",
    });
  }

  if (rules.missingHours && input.daysMissingHours.length > 0) {
    const n = input.daysMissingHours.length;
    out.push({
      key: `hours:${input.daysMissingHours.join(",")}`,
      kind: "missing_hours",
      severity: "warning",
      title: `${n} ${n === 1 ? "día laborable" : "días laborables"} sin horas registradas`,
      description: `El más reciente: ${formatDate(input.daysMissingHours[input.daysMissingHours.length - 1], "weekday")}.`,
      href: "/horas",
    });
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((x, y) => order[x.severity] - order[y.severity] || (x.date ?? "9999").localeCompare(y.date ?? "9999"));
}

/** Recordatorios que deben enviarse al móvil (y aún no se han enviado). */
export function pendingPushes(alerts: AppAlert[], alreadySent: ReadonlySet<string>): AppAlert[] {
  return alerts.filter((a) => a.push && !alreadySent.has(a.key));
}

