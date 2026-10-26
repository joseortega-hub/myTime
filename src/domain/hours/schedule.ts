/**
 * Jornada laboral y horas esperadas por día.
 */
import type { AbsenceRecord } from "../absences";
import type { CalendarIndex } from "../calendar";
import { isoWeekday, type IsoDate } from "../dates";

export interface ScheduleDay {
  weekday: number; // 1 = lunes … 7 = domingo
  startTime: string; // "HH:MM"
  endTime: string;
  breakMinutes: number;
}

/** Horario indicado por el usuario: L-J 8:00-18:00 con 1 h de comida (entre 13:00 y 16:00) = 9 h; V 8:00-15:00 = 7 h. Editable en Ajustes. */
export const DEFAULT_SCHEDULE: ScheduleDay[] = [
  { weekday: 1, startTime: "08:00", endTime: "18:00", breakMinutes: 60 },
  { weekday: 2, startTime: "08:00", endTime: "18:00", breakMinutes: 60 },
  { weekday: 3, startTime: "08:00", endTime: "18:00", breakMinutes: 60 },
  { weekday: 4, startTime: "08:00", endTime: "18:00", breakMinutes: 60 },
  { weekday: 5, startTime: "08:00", endTime: "15:00", breakMinutes: 0 },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(t: string): number {
  const m = TIME_RE.exec(t);
  if (!m) throw new RangeError(`Hora no válida: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

export function scheduledMinutes(day: ScheduleDay): number {
  return Math.max(0, parseTime(day.endTime) - parseTime(day.startTime) - day.breakMinutes);
}

/**
 * Minutos que se espera imputar un día: 0 en festivos, días no laborables y
 * ausencias aprobadas/disfrutadas de jornada completa; la mitad con media jornada.
 */
export function expectedMinutes(
  date: IsoDate,
  schedule: ScheduleDay[],
  calendar: CalendarIndex,
  absences: AbsenceRecord[],
): number {
  if (!calendar.isWorkingDay(date)) return 0;
  const day = schedule.find((s) => s.weekday === isoWeekday(date));
  if (!day) return 0;
  const base = scheduledMinutes(day);
  let fraction = 1;
  for (const a of absences) {
    if (a.status !== "APPROVED" && a.status !== "TAKEN") continue;
    if (date < a.startDate || date > a.endDate) continue;
    fraction -= a.portion === "FULL" ? 1 : 0.5;
  }
  return Math.round(base * Math.max(0, fraction));
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${String(m).padStart(2, "0")} min`;
}
