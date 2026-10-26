/**
 * Plazos para pedir vacaciones con antelación (por defecto, 3 meses).
 *
 * Regla: un día D se puede pedir dentro de plazo si hoy ≤ D − N meses.
 * Si el día no existe en el mes destino (p. ej. 31 → noviembre) se usa el
 * último día de ese mes.
 */
import { addDays, daysInMonth, diffDays, endOfMonth, makeIso, monthOf, yearOf, type IsoDate } from "./dates";

export const DEFAULT_LEAD_MONTHS = 3;

export function addMonths(date: IsoDate, n: number): IsoDate {
  const y = yearOf(date);
  const m = monthOf(date) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = (((m % 12) + 12) % 12) + 1;
  const d = Math.min(Number(date.slice(8, 10)), daysInMonth(ny, nm));
  return makeIso(ny, nm, d);
}

/** Último día para pedir el día `date` dentro de plazo. */
export function requestDeadline(date: IsoDate, leadMonths = DEFAULT_LEAD_MONTHS): IsoDate {
  return addMonths(date, -leadMonths);
}

export function isWithinLeadTime(date: IsoDate, today: IsoDate, leadMonths = DEFAULT_LEAD_MONTHS): boolean {
  return requestDeadline(date, leadMonths) >= today;
}

/** Primer día que todavía se puede pedir dentro de plazo. */
export function firstRequestableDate(today: IsoDate, leadMonths = DEFAULT_LEAD_MONTHS): IsoDate {
  let d = addMonths(today, leadMonths);
  // Corrige el redondeo de fin de mes: busca el primer día con plazo vigente.
  while (requestDeadline(addDays(d, -1), leadMonths) >= today) d = addDays(d, -1);
  while (requestDeadline(d, leadMonths) < today) d = addDays(d, 1);
  return d;
}

export interface ClosingWindow {
  /** Mes que se está cerrando (el más próximo que aún se puede pedir en parte). */
  year: number;
  month: number;
  /** Desde qué día de ese mes se puede pedir todavía. */
  firstRequestable: IsoDate;
  /** Último día de plazo para pedir cualquier día de ese mes. */
  lastDeadline: IsoDate;
  daysLeft: number;
}

/** Ventana que se está cerrando: "te quedas sin tiempo si quieres vacaciones en este mes". */
export function closingWindow(today: IsoDate, leadMonths = DEFAULT_LEAD_MONTHS): ClosingWindow {
  const first = firstRequestableDate(today, leadMonths);
  const y = yearOf(first);
  const m = monthOf(first);
  const lastDeadline = requestDeadline(endOfMonth(y, m), leadMonths);
  return { year: y, month: m, firstRequestable: first, lastDeadline, daysLeft: diffDays(today, lastDeadline) };
}

export type DayRequestState = "past" | "closed" | "closing" | "open";

/**
 * Estado de un día para el mapa de vacaciones:
 * - past: ya ha pasado.
 * - closed: fuera de plazo (ya no se puede pedir con la antelación requerida).
 * - closing: el plazo vence en `closingDays` días o menos.
 * - open: se puede pedir con margen.
 */
export function dayRequestState(date: IsoDate, today: IsoDate, leadMonths = DEFAULT_LEAD_MONTHS, closingDays = 14): DayRequestState {
  if (date < today) return "past";
  const deadline = requestDeadline(date, leadMonths);
  if (deadline < today) return "closed";
  if (diffDays(today, deadline) <= closingDays) return "closing";
  return "open";
}

/** Fecha límite para pedir un mes entero (la del día 1). */
export function monthDeadline(year: number, month: number, leadMonths = DEFAULT_LEAD_MONTHS): IsoDate {
  return requestDeadline(makeIso(year, month, 1), leadMonths);
}
