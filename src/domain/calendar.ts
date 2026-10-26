/**
 * Calendario laboral: qué días se trabaja según los días laborables de la
 * semana configurados y los festivos registrados. No contiene festivos
 * oficiales precargados: se introducen a mano o se importan.
 */
import { eachDay, endOfYear, isoWeekday, startOfYear, yearOf, type IsoDate } from "./dates";

export type HolidayScope = "NATIONAL" | "REGIONAL" | "LOCAL" | "COMPANY";

export interface HolidayInfo {
  date: IsoDate;
  name: string;
  scope: HolidayScope;
}

export interface WorkCalendarRules {
  /** 1 = lunes … 7 = domingo */
  workingWeekdays: number[];
  holidays: HolidayInfo[];
  /** Años cuyos festivos el usuario confirmó como completos. */
  verifiedYears?: number[];
}

export type DayKind = "working" | "non_working" | "holiday";

export interface DayClassification {
  date: IsoDate;
  kind: DayKind;
  holiday?: HolidayInfo;
}

export const HOLIDAY_SCOPE_LABEL: Record<HolidayScope, string> = {
  NATIONAL: "Nacional",
  REGIONAL: "Autonómico",
  LOCAL: "Local",
  COMPANY: "Empresa",
};

/** Índice de festivos por fecha para consultas O(1). */
export class CalendarIndex {
  private readonly holidays = new Map<IsoDate, HolidayInfo>();
  private readonly working: Set<number>;

  constructor(readonly rules: WorkCalendarRules) {
    for (const h of rules.holidays) this.holidays.set(h.date, h);
    this.working = new Set(rules.workingWeekdays);
  }

  classify(date: IsoDate): DayClassification {
    const holiday = this.holidays.get(date);
    if (!this.working.has(isoWeekday(date))) return { date, kind: "non_working", holiday };
    if (holiday) return { date, kind: "holiday", holiday };
    return { date, kind: "working" };
  }

  isWorkingDay(date: IsoDate): boolean {
    return this.working.has(isoWeekday(date)) && !this.holidays.has(date);
  }

  holidayOn(date: IsoDate): HolidayInfo | undefined {
    return this.holidays.get(date);
  }

  /** Días laborables (sin festivos ni días no laborables) en [start, end]. */
  countWorkingDays(start: IsoDate, end: IsoDate): number {
    let n = 0;
    for (const d of eachDay(start, end)) if (this.isWorkingDay(d)) n++;
    return n;
  }

  workingDaysIn(start: IsoDate, end: IsoDate): IsoDate[] {
    return eachDay(start, end).filter((d) => this.isWorkingDay(d));
  }

  holidaysIn(start: IsoDate, end: IsoDate): HolidayInfo[] {
    return this.rules.holidays
      .filter((h) => h.date >= start && h.date <= end)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
}

export function countWorkingDays(start: IsoDate, end: IsoDate, rules: WorkCalendarRules): number {
  return new CalendarIndex(rules).countWorkingDays(start, end);
}

export interface PeriodSummary {
  naturalDays: number;
  workingDays: number;
  nonWorkingDays: number;
  holidaysOnWorkingDays: number;
  holidays: HolidayInfo[];
}

export function summarizePeriod(start: IsoDate, end: IsoDate, rules: WorkCalendarRules): PeriodSummary {
  const idx = new CalendarIndex(rules);
  let working = 0;
  let nonWorking = 0;
  let holidayWeekdays = 0;
  for (const d of eachDay(start, end)) {
    const c = idx.classify(d);
    if (c.kind === "working") working++;
    else if (c.kind === "holiday") holidayWeekdays++;
    else nonWorking++;
  }
  return {
    naturalDays: working + nonWorking + holidayWeekdays,
    workingDays: working,
    nonWorkingDays: nonWorking,
    holidaysOnWorkingDays: holidayWeekdays,
    holidays: idx.holidaysIn(start, end),
  };
}

export interface CompletenessReport {
  year: number;
  complete: boolean;
  holidayCount: number;
  reasons: string[];
}

/**
 * Un calendario se considera completo para un año solo si el usuario lo ha
 * confirmado expresamente. Nunca se deduce a partir del número de festivos.
 */
export function calendarCompleteness(rules: WorkCalendarRules, year: number): CompletenessReport {
  const count = rules.holidays.filter((h) => yearOf(h.date) === year).length;
  const verified = (rules.verifiedYears ?? []).includes(year);
  const reasons: string[] = [];
  if (count === 0) reasons.push(`No hay festivos registrados para ${year}.`);
  if (!verified) reasons.push(`El listado de festivos de ${year} no está confirmado como completo.`);
  if (rules.workingWeekdays.length === 0) reasons.push("No hay días laborables configurados.");
  return { year, complete: verified && rules.workingWeekdays.length > 0, holidayCount: count, reasons };
}

export function yearBounds(year: number): [IsoDate, IsoDate] {
  return [startOfYear(year), endOfYear(year)];
}
