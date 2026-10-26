/**
 * Guardias: presenciales, en remoto o localizables.
 */
import { spanDays, yearOf, type IsoDate } from "./dates";

export const ONCALL_KINDS = ["ON_SITE", "REMOTE", "ON_CALL"] as const;
export type OnCallKind = (typeof ONCALL_KINDS)[number];
export const ONCALL_STATUSES = ["PLANNED", "DONE", "CANCELLED"] as const;
export type OnCallStatus = (typeof ONCALL_STATUSES)[number];
export const ONCALL_COMPENSATIONS = ["PENDING", "NONE", "PAID", "DAYS"] as const;
export type OnCallCompensation = (typeof ONCALL_COMPENSATIONS)[number];

export const ONCALL_KIND_LABEL: Record<OnCallKind, string> = {
  ON_SITE: "Presencial",
  REMOTE: "En remoto",
  ON_CALL: "Localizable",
};
export const ONCALL_STATUS_LABEL: Record<OnCallStatus, string> = {
  PLANNED: "Programada",
  DONE: "Hecha",
  CANCELLED: "Cancelada",
};
export const ONCALL_COMPENSATION_LABEL: Record<OnCallCompensation, string> = {
  PENDING: "Compensación pendiente",
  NONE: "Sin compensación",
  PAID: "Pagada",
  DAYS: "Compensada con días",
};

export interface OnCallRecord {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
  kind: OnCallKind;
  status: OnCallStatus;
  workedMinutes: number;
  compensation: OnCallCompensation;
  compensationDays: number | null;
}

export interface OnCallSummary {
  shifts: number;
  days: number;
  workedMinutes: number;
  compensationDays: number;
  pendingCompensation: number;
  upcoming: number;
}

export function summarizeOnCall(shifts: OnCallRecord[], year: number, today: IsoDate): OnCallSummary {
  const active = shifts.filter((s) => s.status !== "CANCELLED" && yearOf(s.startDate) === year);
  return {
    shifts: active.length,
    days: active.reduce((n, s) => n + spanDays(s.startDate, s.endDate), 0),
    workedMinutes: active.reduce((n, s) => n + s.workedMinutes, 0),
    compensationDays: active.filter((s) => s.compensation === "DAYS").reduce((n, s) => n + (s.compensationDays ?? 0), 0),
    pendingCompensation: active.filter((s) => s.status === "DONE" && s.compensation === "PENDING").length,
    upcoming: active.filter((s) => s.endDate >= today && s.status === "PLANNED").length,
  };
}
