import type { AbsenceStatus, AbsenceType } from "@/domain/absences";

/** Tono de insignia por estado. */
export const STATUS_TONE: Record<AbsenceStatus, "success" | "warning" | "neutral" | "planned" | "primary"> = {
  PLANNED: "planned",
  REQUESTED: "warning",
  APPROVED: "success",
  TAKEN: "primary",
  REJECTED: "neutral",
  CANCELLED: "neutral",
};

/** Clases de celda de calendario por estado (color + textura). */
export const STATUS_CELL: Record<AbsenceStatus, string> = {
  PLANNED: "pattern-planned text-planned",
  REQUESTED: "bg-pending-soft text-pending ring-1 ring-inset ring-pending/50",
  APPROVED: "bg-approved-soft text-approved",
  TAKEN: "bg-taken-soft text-taken",
  REJECTED: "pattern-rejected text-rejected line-through",
  CANCELLED: "pattern-rejected text-rejected line-through",
};

export const STATUS_DOT: Record<AbsenceStatus, string> = {
  PLANNED: "bg-planned",
  REQUESTED: "bg-pending",
  APPROVED: "bg-approved",
  TAKEN: "bg-taken",
  REJECTED: "bg-rejected",
  CANCELLED: "bg-rejected",
};

/** Letra corta del tipo para el calendario. */
export const TYPE_SHORT: Record<AbsenceType, string> = {
  VACATION: "V",
  COMPENSATORY: "C",
  PERSONAL_DAY: "AP",
  SICK_LEAVE: "B",
  OTHER: "O",
};
