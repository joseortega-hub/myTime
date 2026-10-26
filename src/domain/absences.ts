/**
 * Ausencias personales: tipos, estados, consumo de días y solapamientos.
 */
import { CalendarIndex } from "./calendar";
import { eachDay, rangesOverlap, yearOf, type IsoDate } from "./dates";

export const ABSENCE_TYPES = ["VACATION", "COMPENSATORY", "PERSONAL_DAY", "SICK_LEAVE", "OTHER"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_STATUSES = ["PLANNED", "REQUESTED", "APPROVED", "TAKEN", "REJECTED", "CANCELLED"] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

export const DAY_PORTIONS = ["FULL", "MORNING", "AFTERNOON"] as const;
export type DayPortion = (typeof DAY_PORTIONS)[number];

export const ABSENCE_TYPE_LABEL: Record<AbsenceType, string> = {
  VACATION: "Vacaciones",
  COMPENSATORY: "Compensado",
  PERSONAL_DAY: "Asuntos propios",
  SICK_LEAVE: "Baja / médico",
  OTHER: "Otra ausencia",
};

export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = {
  PLANNED: "Planificada",
  REQUESTED: "Pendiente",
  APPROVED: "Aprobada",
  TAKEN: "Disfrutada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
};

export const DAY_PORTION_LABEL: Record<DayPortion, string> = {
  FULL: "Jornada completa",
  MORNING: "Media jornada (mañana)",
  AFTERNOON: "Media jornada (tarde)",
};

/** Tipos de ausencia que tienen saldo anual propio. */
export const BALANCE_TYPES: AbsenceType[] = ["VACATION", "COMPENSATORY", "PERSONAL_DAY"];

/** Estados que descuentan saldo. Pendientes, planificadas y rechazadas NO descuentan. */
export const DEDUCTING_STATUSES: ReadonlySet<AbsenceStatus> = new Set(["APPROVED", "TAKEN"]);

/** Estados que ocupan el día (se usan para detectar solapamientos). */
export const ACTIVE_STATUSES: ReadonlySet<AbsenceStatus> = new Set(["PLANNED", "REQUESTED", "APPROVED", "TAKEN"]);

export interface AbsenceRecord {
  id: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: IsoDate;
  endDate: IsoDate;
  portion: DayPortion;
  daysOverride?: number | null;
}

export interface DayConsumption {
  date: IsoDate;
  amount: number;
}

export interface Consumption {
  /** Total de días que consume. */
  total: number;
  /** Reparto por año (las ausencias pueden cruzar el cambio de año). */
  byYear: Map<number, number>;
  /** Detalle por día laborable. Vacío si se usa `daysOverride`. */
  days: DayConsumption[];
  overridden: boolean;
}

/**
 * Días que consume una ausencia según el calendario laboral.
 * Excluye días no laborables y festivos. Media jornada = 0,5.
 */
export function computeConsumption(absence: AbsenceRecord, cal: CalendarIndex): Consumption {
  const unit = absence.portion === "FULL" ? 1 : 0.5;
  const days: DayConsumption[] = [];
  const byYear = new Map<number, number>();
  for (const date of eachDay(absence.startDate, absence.endDate)) {
    if (!cal.isWorkingDay(date)) continue;
    days.push({ date, amount: unit });
    const y = yearOf(date);
    byYear.set(y, (byYear.get(y) ?? 0) + unit);
  }
  const computed = days.reduce((s, d) => s + d.amount, 0);

  if (absence.daysOverride == null) {
    return { total: computed, byYear, days, overridden: false };
  }

  // Valor indicado por el usuario: se reparte por años de forma proporcional
  // a los días laborables calculados (o se asigna al año de inicio).
  const override = absence.daysOverride;
  const overrideByYear = new Map<number, number>();
  if (computed > 0 && byYear.size > 1) {
    for (const [y, v] of byYear) overrideByYear.set(y, round2((v / computed) * override));
  } else {
    overrideByYear.set(yearOf(absence.startDate), override);
  }
  return { total: override, byYear: overrideByYear, days: [], overridden: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function portionsConflict(a: AbsenceRecord, b: AbsenceRecord): boolean {
  // Dos medias jornadas distintas del mismo día no se solapan.
  if (a.startDate === a.endDate && b.startDate === b.endDate && a.startDate === b.startDate) {
    if (a.portion !== "FULL" && b.portion !== "FULL" && a.portion !== b.portion) return false;
  }
  return true;
}

/** Ausencias activas que coinciden en fechas con `candidate`. */
export function findOverlaps<T extends AbsenceRecord>(candidate: AbsenceRecord, existing: T[]): T[] {
  if (!ACTIVE_STATUSES.has(candidate.status)) return [];
  return existing.filter(
    (e) =>
      e.id !== candidate.id &&
      ACTIVE_STATUSES.has(e.status) &&
      rangesOverlap(candidate.startDate, candidate.endDate, e.startDate, e.endDate) &&
      portionsConflict(candidate, e),
  );
}

/** Mismo tipo, mismas fechas y misma porción: se considera un duplicado. */
export function findDuplicate<T extends AbsenceRecord>(candidate: AbsenceRecord, existing: T[]): T | undefined {
  if (!ACTIVE_STATUSES.has(candidate.status)) return undefined;
  return existing.find(
    (e) =>
      e.id !== candidate.id &&
      ACTIVE_STATUSES.has(e.status) &&
      e.type === candidate.type &&
      e.startDate === candidate.startDate &&
      e.endDate === candidate.endDate &&
      e.portion === candidate.portion,
  );
}

/** Transiciones de estado permitidas en la gestión manual. */
export function allowedTransitions(status: AbsenceStatus): AbsenceStatus[] {
  switch (status) {
    case "PLANNED":
      return ["REQUESTED", "APPROVED", "CANCELLED"];
    case "REQUESTED":
      return ["APPROVED", "REJECTED", "CANCELLED", "PLANNED"];
    case "APPROVED":
      return ["TAKEN", "REQUESTED", "CANCELLED"];
    case "TAKEN":
      return ["APPROVED"];
    case "REJECTED":
      return ["REQUESTED", "PLANNED"];
    case "CANCELLED":
      return ["PLANNED", "REQUESTED"];
  }
}
