/**
 * Mapeo de campos y estados de Jira → modelo de MyTime.
 *
 * Los nombres reales de campos personalizados, estados y claves de tareas
 * de la empresa NO se conocen todavía: se configuran en
 * config/jira-mapping.json (ver el ejemplo con valores de marcador).
 *
 * Se admiten dos estrategias porque aún no se sabe cómo se registran:
 * - "issue":   cada solicitud es una incidencia con fechas de inicio/fin.
 * - "worklog": las ausencias se imputan como horas en una tarea fija por tipo.
 */
import { z } from "zod";
import { ABSENCE_STATUSES, ABSENCE_TYPES, type AbsenceStatus, type AbsenceType } from "@/domain/absences";
import { addDays, isIsoDate, type IsoDate } from "@/domain/dates";
import { JiraError, type ExternalAbsence } from "./types";

const typeEnum = z.enum(ABSENCE_TYPES);
const statusEnum = z.enum(ABSENCE_STATUSES);

export const jiraMappingSchema = z.discriminatedUnion("strategy", [
  z.object({
    strategy: z.literal("issue"),
    /** JQL que devuelve TUS solicitudes. Se le añade el filtro de fechas. */
    jql: z.string().min(1),
    fields: z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      /** Campo con el tipo de ausencia (opcional). */
      absenceType: z.string().optional(),
    }),
    /** Valor del campo de tipo → tipo de MyTime. */
    typeValues: z.record(z.string(), typeEnum).default({}),
    defaultType: typeEnum.default("VACATION"),
    /** Nombre del estado de Jira → estado de MyTime. */
    statusValues: z.record(z.string(), statusEnum),
  }),
  z.object({
    strategy: z.literal("worklog"),
    /** Clave de la tarea donde se imputa cada tipo de ausencia. */
    issueKeys: z.record(z.string(), typeEnum),
    /** Estado con el que se registran (las imputaciones no tienen aprobación). */
    status: statusEnum.default("APPROVED"),
    /** Minutos imputados que equivalen a una jornada completa. */
    fullDayMinutes: z.number().int().min(60).max(24 * 60).default(480),
  }),
]);
export type JiraMapping = z.infer<typeof jiraMappingSchema>;

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & { status?: { name?: string }; updated?: string };
}

function readDate(value: unknown): IsoDate | null {
  if (typeof value !== "string") return null;
  const d = value.slice(0, 10);
  return isIsoDate(d) ? d : null;
}

function readOption(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value && typeof (value as { value: unknown }).value === "string")
    return (value as { value: string }).value;
  return null;
}

/** Convierte una incidencia en ausencia, o null si el estado no está mapeado. */
export function mapIssueToAbsence(issue: JiraIssue, mapping: Extract<JiraMapping, { strategy: "issue" }>): ExternalAbsence | null {
  const start = readDate(issue.fields[mapping.fields.startDate]);
  const end = readDate(issue.fields[mapping.fields.endDate]) ?? start;
  if (!start || !end) throw new JiraError("mapping", `La incidencia ${issue.key} no tiene fechas en los campos configurados.`);
  const statusName = issue.fields.status?.name ?? "";
  const status: AbsenceStatus | undefined = mapping.statusValues[statusName];
  if (!status) return null;
  let type: AbsenceType = mapping.defaultType;
  if (mapping.fields.absenceType) {
    const raw = readOption(issue.fields[mapping.fields.absenceType]);
    if (raw && mapping.typeValues[raw]) type = mapping.typeValues[raw];
  }
  return {
    externalId: issue.key,
    type,
    status,
    startDate: start <= end ? start : end,
    endDate: start <= end ? end : start,
    portion: "FULL",
    updatedAt: typeof issue.fields.updated === "string" ? issue.fields.updated : null,
  };
}

export interface JiraWorklog {
  id: string;
  issueKey: string;
  started: string;
  timeSpentSeconds: number;
  updated?: string;
}

/**
 * Agrupa imputaciones diarias en ausencias de días consecutivos.
 * Imputar menos de una jornada completa se trata como media jornada.
 */
export function groupWorklogsToAbsences(
  worklogs: JiraWorklog[],
  mapping: Extract<JiraMapping, { strategy: "worklog" }>,
): ExternalAbsence[] {
  type Day = { date: IsoDate; minutes: number; type: AbsenceType; ids: string[] };
  const byKey = new Map<string, Day>();
  for (const w of worklogs) {
    const type = mapping.issueKeys[w.issueKey];
    const date = readDate(w.started);
    if (!type || !date) continue;
    const k = `${type}|${date}`;
    const d = byKey.get(k) ?? { date, minutes: 0, type, ids: [] };
    d.minutes += Math.round(w.timeSpentSeconds / 60);
    d.ids.push(w.id);
    byKey.set(k, d);
  }
  const days = [...byKey.values()].sort((a, b) => (a.type + a.date < b.type + b.date ? -1 : 1));
  const out: ExternalAbsence[] = [];
  let cur: { type: AbsenceType; start: IsoDate; end: IsoDate; ids: string[]; half: boolean } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({
      externalId: `worklog:${cur.type}:${cur.start}`,
      type: cur.type,
      status: mapping.status,
      startDate: cur.start,
      endDate: cur.end,
      portion: cur.half ? "MORNING" : "FULL",
      updatedAt: null,
    });
    cur = null;
  };
  for (const d of days) {
    const half = d.minutes < mapping.fullDayMinutes;
    if (cur && cur.type === d.type && addDays(cur.end, 1) === d.date && !half && !cur.half) {
      cur.end = d.date;
      cur.ids.push(...d.ids);
    } else {
      flush();
      cur = { type: d.type, start: d.date, end: d.date, ids: [...d.ids], half };
    }
  }
  flush();
  return out;
}
