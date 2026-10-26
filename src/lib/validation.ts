/**
 * Esquemas Zod compartidos. El servidor valida SIEMPRE con estos esquemas,
 * aunque el formulario ya haya validado en el navegador.
 */
import { z } from "zod";
import { ABSENCE_STATUSES, ABSENCE_TYPES, DAY_PORTIONS } from "@/domain/absences";
import { isIsoDate, spanDays, yearOf } from "@/domain/dates";
import { isValidTime } from "@/domain/hours/schedule";

export const isoDate = z.string().trim().refine(isIsoDate, { message: "Fecha no válida (AAAA-MM-DD)." });
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());
const halfDays = z.number().min(0).max(366).refine((n) => Number.isInteger(n * 2), "Usa múltiplos de 0,5.");

export const absenceInputSchema = z
  .object({
    type: z.enum(ABSENCE_TYPES),
    status: z.enum(ABSENCE_STATUSES),
    startDate: isoDate,
    endDate: isoDate,
    portion: z.enum(DAY_PORTIONS).default("FULL"),
    daysOverride: halfDays.nullable().optional(),
    notes: optionalText(500),
    allowOverlap: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.startDate > v.endDate)
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fecha de fin no puede ser anterior a la de inicio." });
    else if (spanDays(v.startDate, v.endDate) > 366)
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Una ausencia no puede durar más de un año." });
    if (v.portion !== "FULL" && v.startDate !== v.endDate)
      ctx.addIssue({ code: "custom", path: ["portion"], message: "La media jornada solo se puede aplicar a un único día." });
    if (v.daysOverride != null && yearOf(v.startDate) !== yearOf(v.endDate))
      ctx.addIssue({ code: "custom", path: ["daysOverride"], message: "Para ausencias que cruzan de año, deja que se calculen los días." });
  });
export type AbsenceInput = z.infer<typeof absenceInputSchema>;

export const statusChangeSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ABSENCE_STATUSES),
  note: optionalText(200),
});

export const balanceInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  absenceType: z.enum(["VACATION", "COMPENSATORY", "PERSONAL_DAY"]),
  allocatedDays: halfDays,
  carryOverDays: z.number().min(-366).max(366).default(0),
  source: z.enum(["OFFICIAL", "ESTIMATED", "MANUAL"]),
  notes: optionalText(300),
});

export const calendarSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  country: optionalText(60),
  region: optionalText(80),
  municipality: optionalText(80),
  workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1, "Selecciona al menos un día laborable.").max(7),
});

export const HOLIDAY_SCOPES = ["NATIONAL", "REGIONAL", "LOCAL", "COMPANY"] as const;

export const holidayInputSchema = z.object({
  date: isoDate,
  name: z.string().trim().min(1, "Indica el nombre del festivo.").max(100),
  scope: z.enum(HOLIDAY_SCOPES),
});

export const holidayImportSchema = z.array(holidayInputSchema).min(1, "El archivo no contiene festivos.").max(500);

/** CSV: fecha;nombre;ámbito (también admite coma). Primera fila opcional de cabecera. */
export function parseHolidayCsv(text: string): { rows: unknown[]; errors: string[] } {
  const rows: unknown[] = [];
  const errors: string[] = [];
  const scopeMap: Record<string, string> = {
    nacional: "NATIONAL", national: "NATIONAL",
    autonomico: "REGIONAL", autonómico: "REGIONAL", regional: "REGIONAL",
    local: "LOCAL", municipal: "LOCAL",
    empresa: "COMPANY", company: "COMPANY",
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const cols = trimmed.split(trimmed.includes(";") ? ";" : ",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && !isIsoDate(cols[0])) return; // cabecera
    if (cols.length < 2) {
      errors.push(`Línea ${i + 1}: faltan columnas.`);
      return;
    }
    const scopeRaw = (cols[2] ?? "").toLowerCase();
    rows.push({ date: cols[0], name: cols[1], scope: scopeMap[scopeRaw] ?? cols[2]?.toUpperCase() ?? "LOCAL" });
  });
  return { rows, errors };
}

export const teamInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  minPresent: z.number().int().min(0).max(500).nullable().optional(),
});

export const personInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  teamId: z.string().min(1),
});

export const teamAbsenceInputSchema = z
  .object({
    personId: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    portion: z.enum(DAY_PORTIONS).default("FULL"),
    status: z.enum(["CONFIRMED", "TENTATIVE"]).default("CONFIRMED"),
  })
  .refine((v) => v.startDate <= v.endDate, { path: ["endDate"], message: "La fecha de fin no puede ser anterior a la de inicio." });

const issueKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/, "Clave de Jira no válida (p. ej. PROJ-123).");

export const workItemInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  projectName: optionalText(80),
  jiraIssueKey: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), issueKey.nullable().optional()),
  aliases: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  active: z.boolean().default(true),
});

export const timeEntryInputSchema = z.object({
  date: isoDate,
  workItemId: z.string().min(1, "Elige un proyecto o tarea."),
  minutes: z.number().int().min(1, "La duración debe ser mayor que cero.").max(16 * 60, "Máximo 16 horas por registro."),
  description: optionalText(300),
  inputMethod: z.enum(["MANUAL", "TEXT", "VOICE"]).default("MANUAL"),
});

export const scheduleSchema = z
  .array(
    z
      .object({
        weekday: z.number().int().min(1).max(7),
        startTime: z.string().refine(isValidTime, "Hora no válida (HH:MM)."),
        endTime: z.string().refine(isValidTime, "Hora no válida (HH:MM)."),
        breakMinutes: z.number().int().min(0).max(480),
      })
      .refine((d) => d.startTime < d.endTime, { message: "La hora de fin debe ser posterior a la de inicio." }),
  )
  .max(7);

export const alertRulesSchema = z.object({
  upcomingAbsenceDays: z.number().int().min(0).max(90),
  reminderOffsets: z.array(z.number().int().min(0).max(60)).max(5).default([7, 1]),
  pendingRequestDays: z.number().int().min(0).max(90),
  vacationLeadMonths: z.number().int().min(0).max(12).default(3),
  yearEndFromMonth: z.number().int().min(1).max(12),
  teamOverlap: z.boolean(),
  missingHours: z.boolean(),
  weeklyJiraClose: z.boolean().default(true),
});

const range = z.object({ start: isoDate, end: isoDate }).refine((r) => r.start <= r.end, "Rango no válido.");

export const optimizerRequestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  range,
  daysToSpend: z.number().int().min(1).max(60),
  excluded: z.array(range).max(50).default([]),
  priority: z.array(range).max(50).default([]),
  reserved: z.array(range.and(z.object({ label: z.string().trim().max(40), days: z.number().int().min(0).max(60) }))).max(10).default([]),
  preferLongBreaks: z.boolean().default(false),
  avoidTeamOverlap: z.boolean().default(false),
  teamId: z.string().nullable().optional(),
});
export type OptimizerRequest = z.infer<typeof optimizerRequestSchema>;

export const savePlanSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  name: z.string().trim().min(1).max(80),
  objective: z.string().max(40),
  score: z.number(),
  blocks: z
    .array(
      z.object({
        vacationDates: z.array(isoDate).min(1).max(60),
        restStart: isoDate,
        restEnd: isoDate,
        restDays: z.number().int().min(1),
        cost: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(30),
});

/** Formato de exportación/importación de datos personales (versión 1). */
export const exportSchema = z.object({
  format: z.literal("mytime-export"),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: z.object({ displayName: z.string().max(80), timezone: z.string().max(60) }),
  calendar: calendarSettingsSchema.extend({ verifiedYears: z.array(z.number().int()).default([]) }),
  holidays: z.array(holidayInputSchema).max(2000),
  balances: z.array(balanceInputSchema).max(200),
  absences: z
    .array(
      z.object({
        type: z.enum(ABSENCE_TYPES),
        status: z.enum(ABSENCE_STATUSES),
        startDate: isoDate,
        endDate: isoDate,
        portion: z.enum(DAY_PORTIONS),
        daysOverride: z.number().nullable(),
        notes: z.string().max(500).nullable(),
      }),
    )
    .max(5000),
  schedule: scheduleSchema,
  workItems: z.array(workItemInputSchema).max(500),
  timeEntries: z
    .array(
      z.object({
        date: isoDate,
        workItemLabel: z.string(),
        minutes: z.number().int().min(1).max(16 * 60),
        description: z.string().max(300).nullable(),
      }),
    )
    .max(50000),
});
export type ExportData = z.infer<typeof exportSchema>;

export function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Datos no válidos.";
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const key = i.path.join(".") || "_";
    if (!out[key]) out[key] = i.message;
  }
  return out;
}
