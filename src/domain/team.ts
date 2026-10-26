/**
 * Disponibilidad del equipo. Solo trabaja con fechas y estado de ausencia:
 * nunca con motivos ni descripciones.
 */
import type { CalendarIndex } from "./calendar";
import { addDays, eachDay, maxIso, minIso, type IsoDate } from "./dates";

export interface TeamMember {
  id: string;
  displayName: string;
  teamId: string;
  isDemo: boolean;
}

export interface TeamAbsenceRecord {
  id: string;
  personId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  portion: "FULL" | "MORNING" | "AFTERNOON";
  status: "CONFIRMED" | "TENTATIVE";
}

export interface DailyAvailability {
  date: IsoDate;
  absent: number;
  tentative: number;
  personIds: string[];
  present: number;
  coverage: "ok" | "warning" | "critical" | "non_working";
}

/** Número de personas ausentes por día en [start, end]. */
export function dailyAbsences(
  absences: TeamAbsenceRecord[],
  start: IsoDate,
  end: IsoDate,
  personIds?: ReadonlySet<string>,
): Map<IsoDate, { absent: Set<string>; tentative: Set<string> }> {
  const map = new Map<IsoDate, { absent: Set<string>; tentative: Set<string> }>();
  for (const a of absences) {
    if (personIds && !personIds.has(a.personId)) continue;
    const s = maxIso(a.startDate, start);
    const e = minIso(a.endDate, end);
    for (const d of eachDay(s, e)) {
      const entry = map.get(d) ?? { absent: new Set(), tentative: new Set() };
      if (a.status === "TENTATIVE") entry.tentative.add(a.personId);
      else entry.absent.add(a.personId);
      map.set(d, entry);
    }
  }
  // Una persona confirmada no cuenta además como tentativa.
  for (const v of map.values()) for (const p of v.absent) v.tentative.delete(p);
  return map;
}

export function availabilitySeries(input: {
  members: TeamMember[];
  absences: TeamAbsenceRecord[];
  start: IsoDate;
  end: IsoDate;
  calendar: CalendarIndex;
  minPresent: number | null;
}): DailyAvailability[] {
  const ids = new Set(input.members.map((m) => m.id));
  const map = dailyAbsences(input.absences, input.start, input.end, ids);
  const size = input.members.length;
  return eachDay(input.start, input.end).map((date) => {
    const entry = map.get(date);
    const absent = entry?.absent.size ?? 0;
    const tentative = entry?.tentative.size ?? 0;
    const present = size - absent;
    let coverage: DailyAvailability["coverage"] = "ok";
    if (!input.calendar.isWorkingDay(date)) coverage = "non_working";
    else if (input.minPresent != null && present < input.minPresent) coverage = "critical";
    else if (input.minPresent != null && present - tentative < input.minPresent) coverage = "warning";
    else if (size > 0 && absent / size >= 0.5) coverage = "warning";
    return {
      date,
      absent,
      tentative,
      personIds: entry ? [...entry.absent, ...entry.tentative] : [],
      present,
      coverage,
    };
  });
}

export interface LowConcentrationWindow {
  start: IsoDate;
  end: IsoDate;
  workingDays: number;
  personDays: number;
  maxAbsent: number;
}

/**
 * Ventanas de `workingDays` días laborables consecutivos con menor suma de
 * ausencias (se recorren todas las ventanas posibles del rango).
 */
export function findLowConcentrationWindows(
  series: DailyAvailability[],
  workingDays: number,
  limit = 5,
): LowConcentrationWindow[] {
  const working = series.filter((d) => d.coverage !== "non_working");
  if (workingDays <= 0 || working.length < workingDays) return [];
  const windows: LowConcentrationWindow[] = [];
  for (let i = 0; i + workingDays <= working.length; i++) {
    const slice = working.slice(i, i + workingDays);
    windows.push({
      start: slice[0].date,
      end: slice[slice.length - 1].date,
      workingDays,
      personDays: slice.reduce((s, d) => s + d.absent + d.tentative * 0.5, 0),
      maxAbsent: slice.reduce((s, d) => Math.max(s, d.absent), 0),
    });
  }
  windows.sort((a, b) => a.personDays - b.personDays || a.maxAbsent - b.maxAbsent || (a.start < b.start ? -1 : 1));
  // Evita ventanas casi idénticas: no se solapan entre sí.
  const out: LowConcentrationWindow[] = [];
  for (const w of windows) {
    if (out.length >= limit) break;
    if (out.some((o) => w.start <= o.end && o.start <= w.end)) continue;
    out.push(w);
  }
  return out;
}

export interface OverlapAlert {
  start: IsoDate;
  end: IsoDate;
  maxAbsent: number;
  level: "warning" | "critical";
}

/** Agrupa días consecutivos con cobertura comprometida. */
export function coverageAlerts(series: DailyAvailability[]): OverlapAlert[] {
  const out: OverlapAlert[] = [];
  for (const d of series) {
    if (d.coverage !== "warning" && d.coverage !== "critical") continue;
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === d.date && last.level === d.coverage) {
      last.end = d.date;
      last.maxAbsent = Math.max(last.maxAbsent, d.absent);
    } else {
      out.push({ start: d.date, end: d.date, maxAbsent: d.absent, level: d.coverage });
    }
  }
  return out;
}

/** Para el optimizador: ausentes por día excluyendo a la persona indicada. */
export function absentCountByDate(absences: TeamAbsenceRecord[], start: IsoDate, end: IsoDate): Map<IsoDate, number> {
  const map = dailyAbsences(absences, start, end);
  const out = new Map<IsoDate, number>();
  for (const [d, v] of map) out.set(d, v.absent.size + v.tentative.size);
  return out;
}
