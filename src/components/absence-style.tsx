import { ABSENCE_TYPE_LABEL, ABSENCE_TYPES, type AbsenceStatus, type AbsenceType } from "@/domain/absences";

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

/** Color del tipo de ausencia (franja o punto), para distinguir vacaciones, compensados, etc. */
export const TYPE_BG: Record<AbsenceType, string> = {
  VACATION: "bg-type-vacation",
  COMPENSATORY: "bg-type-compensatory",
  PERSONAL_DAY: "bg-type-personal",
  SICK_LEAVE: "bg-type-sick",
  OTHER: "bg-type-other",
};

export const TYPE_BORDER: Record<AbsenceType, string> = {
  VACATION: "border-type-vacation",
  COMPENSATORY: "border-type-compensatory",
  PERSONAL_DAY: "border-type-personal",
  SICK_LEAVE: "border-type-sick",
  OTHER: "border-type-other",
};

/** Leyenda de colores por tipo de ausencia. */
export function TypeLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Colores por tipo de ausencia" className={["flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft", className].filter(Boolean).join(" ")}>
      {ABSENCE_TYPES.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-4 rounded-full ${TYPE_BG[t]}`} aria-hidden />
          {ABSENCE_TYPE_LABEL[t]}
        </li>
      ))}
    </ul>
  );
}

/** Letra corta del tipo para el calendario. */
export const TYPE_SHORT: Record<AbsenceType, string> = {
  VACATION: "V",
  COMPENSATORY: "C",
  PERSONAL_DAY: "AP",
  SICK_LEAVE: "B",
  OTHER: "O",
};
