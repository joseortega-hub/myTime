/**
 * Cálculo del saldo anual. Reglas (ver docs/ALGORITHM.md):
 *
 * - Solo descuentan las ausencias APROBADAS o DISFRUTADAS del tipo y año.
 * - Las pendientes, planificadas, rechazadas y canceladas no descuentan.
 * - Cada día laborable se descuenta como máximo una vez aunque haya registros
 *   duplicados o solapados (mañana + tarde del mismo día = 1 día).
 * - Disfrutado: estado DISFRUTADA o APROBADA con fecha anterior a hoy.
 * - Aprobado pendiente de disfrutar: APROBADA con fecha de hoy en adelante.
 * - Si no hay saldo configurado, el disponible es desconocido (null).
 */
import type { CalendarIndex } from "./calendar";
import {
  computeConsumption,
  DEDUCTING_STATUSES,
  type AbsenceRecord,
  type AbsenceType,
  type DayPortion,
} from "./absences";
import { yearOf, type IsoDate } from "./dates";

export type BalanceSource = "OFFICIAL" | "ESTIMATED" | "MANUAL";

export const BALANCE_SOURCE_LABEL: Record<BalanceSource, string> = {
  OFFICIAL: "Saldo oficial confirmado",
  ESTIMATED: "Saldo estimado",
  MANUAL: "Introducido manualmente",
};

export interface BalanceConfig {
  allocatedDays: number;
  carryOverDays: number;
  source: BalanceSource;
}

export interface BalanceSummary {
  year: number;
  type: AbsenceType;
  configured: boolean;
  source: BalanceSource | null;
  allocated: number | null;
  carryOver: number;
  total: number | null;
  enjoyed: number;
  approvedUpcoming: number;
  consumed: number;
  requested: number;
  planned: number;
  available: number | null;
  availableIfRequestsApproved: number | null;
  exact: boolean;
  warnings: string[];
}

interface DayMark {
  full: boolean;
  morning: boolean;
  afternoon: boolean;
  enjoyed: boolean;
}

function markAmount(m: DayMark): number {
  if (m.full || (m.morning && m.afternoon)) return 1;
  return m.morning || m.afternoon ? 0.5 : 0;
}

function addMark(map: Map<IsoDate, DayMark>, date: IsoDate, portion: DayPortion, enjoyed: boolean) {
  const m = map.get(date) ?? { full: false, morning: false, afternoon: false, enjoyed: false };
  if (portion === "FULL") m.full = true;
  else if (portion === "MORNING") m.morning = true;
  else m.afternoon = true;
  m.enjoyed = m.enjoyed || enjoyed;
  map.set(date, m);
}

function sumMarks(map: Map<IsoDate, DayMark>, filter?: (m: DayMark, d: IsoDate) => boolean): number {
  let s = 0;
  for (const [d, m] of map) if (!filter || filter(m, d)) s += markAmount(m);
  return s;
}

export interface ComputeBalanceInput {
  year: number;
  type: AbsenceType;
  config: BalanceConfig | null;
  absences: AbsenceRecord[];
  calendar: CalendarIndex;
  today: IsoDate;
  calendarComplete: boolean;
}

export function computeBalance(input: ComputeBalanceInput): BalanceSummary {
  const { year, type, config, calendar, today } = input;
  const warnings: string[] = [];
  const relevant = input.absences.filter((a) => a.type === type);

  const deducted = new Map<IsoDate, DayMark>();
  const requested = new Map<IsoDate, DayMark>();
  const planned = new Map<IsoDate, DayMark>();
  let overrideEnjoyed = 0;
  let overrideUpcoming = 0;
  let overrideRequested = 0;
  let overridePlanned = 0;

  for (const a of relevant) {
    const c = computeConsumption(a, calendar);
    const inYear = c.byYear.get(year) ?? 0;
    if (inYear === 0) continue;

    if (c.overridden) {
      if (DEDUCTING_STATUSES.has(a.status)) {
        if (a.status === "TAKEN" || a.endDate < today) overrideEnjoyed += inYear;
        else overrideUpcoming += inYear;
      } else if (a.status === "REQUESTED") overrideRequested += inYear;
      else if (a.status === "PLANNED") overridePlanned += inYear;
      continue;
    }

    for (const d of c.days) {
      if (yearOf(d.date) !== year) continue;
      if (DEDUCTING_STATUSES.has(a.status)) {
        addMark(deducted, d.date, a.portion, a.status === "TAKEN" || d.date < today);
      } else if (a.status === "REQUESTED") {
        addMark(requested, d.date, a.portion, false);
      } else if (a.status === "PLANNED") {
        addMark(planned, d.date, a.portion, false);
      }
    }
  }

  // Un día ya descontado no vuelve a contar como pendiente o planificado.
  const notDeducted = (_m: DayMark, d: IsoDate) => !deducted.has(d);
  const enjoyed = sumMarks(deducted, (m) => m.enjoyed) + overrideEnjoyed;
  const approvedUpcoming = sumMarks(deducted, (m) => !m.enjoyed) + overrideUpcoming;
  const req = sumMarks(requested, notDeducted) + overrideRequested;
  const plan = sumMarks(planned, (m, d) => !deducted.has(d) && !requested.has(d)) + overridePlanned;
  const consumed = enjoyed + approvedUpcoming;

  if (overrideEnjoyed + overrideUpcoming > 0 && deducted.size > 0) {
    warnings.push(
      "Hay ausencias con días indicados manualmente: revisa que no coincidan con otras para evitar descontarlas dos veces.",
    );
  }

  let exact = true;
  if (!input.calendarComplete) {
    exact = false;
    warnings.push(
      `Los festivos de ${year} no están confirmados: los días consumidos pueden variar cuando se completen.`,
    );
  }

  if (!config) {
    warnings.push("No hay saldo anual configurado: no es posible calcular los días disponibles.");
    return {
      year, type, configured: false, source: null, allocated: null, carryOver: 0, total: null,
      enjoyed, approvedUpcoming, consumed, requested: req, planned: plan,
      available: null, availableIfRequestsApproved: null, exact: false, warnings,
    };
  }

  if (config.source === "ESTIMATED") {
    exact = false;
    warnings.push("El saldo asignado es una estimación, no un dato oficial.");
  }

  const total = config.allocatedDays + config.carryOverDays;
  const available = round(total - consumed);
  const availableIfRequestsApproved = round(available - req);
  if (available < 0) warnings.push("El saldo disponible es negativo: revisa las ausencias aprobadas.");
  else if (availableIfRequestsApproved < 0)
    warnings.push("Si se aprueban todas las solicitudes pendientes, el saldo quedaría en negativo.");

  return {
    year, type, configured: true, source: config.source,
    allocated: config.allocatedDays, carryOver: config.carryOverDays, total,
    enjoyed, approvedUpcoming, consumed, requested: req, planned: plan,
    available, availableIfRequestsApproved, exact, warnings,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
