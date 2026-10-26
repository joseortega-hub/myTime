/**
 * Utilidades de fechas de calendario.
 *
 * Estrategia: todas las fechas de negocio son cadenas ISO "YYYY-MM-DD" sin hora
 * ni zona horaria. La aritmética se hace en milisegundos UTC, de modo que los
 * cambios de horario de verano o la zona del servidor nunca desplazan un día.
 * Solo `todayIso` necesita una zona horaria, para decidir qué día es "hoy".
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Fecha no válida: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function toUtcMs(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function fromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return makeIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function makeIso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** Número de días de `a` a `b` (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** Días naturales de un periodo cerrado [start, end]. */
export function spanDays(start: IsoDate, end: IsoDate): number {
  return diffDays(start, end) + 1;
}

/** 1 = lunes … 7 = domingo (ISO-8601). */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(toUtcMs(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function yearOf(date: IsoDate): number {
  return parts(date)[0];
}

export function monthOf(date: IsoDate): number {
  return parts(date)[1];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** Itera cada día del periodo cerrado [start, end]. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  if (start > end) return [];
  const out: IsoDate[] = [];
  const last = toUtcMs(end);
  for (let ms = toUtcMs(start); ms <= last; ms += DAY_MS) out.push(fromUtcMs(ms));
  return out;
}

export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function startOfYear(year: number): IsoDate {
  return makeIso(year, 1, 1);
}

export function endOfYear(year: number): IsoDate {
  return makeIso(year, 12, 31);
}

export function startOfMonth(year: number, month: number): IsoDate {
  return makeIso(year, month, 1);
}

export function endOfMonth(year: number, month: number): IsoDate {
  return makeIso(year, month, daysInMonth(year, month));
}

/** Lunes de la semana a la que pertenece la fecha. */
export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Fecha de hoy en la zona horaria indicada (por defecto Europe/Madrid). */
export function todayIso(timeZone = "Europe/Madrid", now: Date = new Date()): IsoDate {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

/**
 * Cuadrícula de un mes para calendario: semanas que empiezan en lunes,
 * con días del mes anterior/siguiente marcados como `outside`.
 */
export function monthGrid(year: number, month: number): { date: IsoDate; outside: boolean }[][] {
  const first = startOfMonth(year, month);
  const last = endOfMonth(year, month);
  let cursor = startOfWeek(first);
  const weeks: { date: IsoDate; outside: boolean }[][] = [];
  while (cursor <= last) {
    const week: { date: IsoDate; outside: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, outside: monthOf(cursor) !== month || yearOf(cursor) !== year });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// ── Formato (es-ES) ─────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("es-ES", { ...options, timeZone: "UTC" });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatDate(date: IsoDate, style: "short" | "medium" | "long" | "weekday" = "medium"): string {
  const d = new Date(toUtcMs(date));
  switch (style) {
    case "short":
      return fmt({ day: "numeric", month: "short" }).format(d);
    case "long":
      return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
    case "weekday":
      return fmt({ weekday: "short", day: "numeric", month: "short" }).format(d);
    default:
      return fmt({ day: "numeric", month: "short", year: "numeric" }).format(d);
  }
}

export function formatRange(start: IsoDate, end: IsoDate): string {
  if (start === end) return formatDate(start, "medium");
  if (yearOf(start) === yearOf(end)) return `${formatDate(start, "short")} – ${formatDate(end, "medium")}`;
  return `${formatDate(start, "medium")} – ${formatDate(end, "medium")}`;
}

export const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const WEEKDAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
