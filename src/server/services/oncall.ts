import "server-only";
import { z } from "zod";
import { ONCALL_COMPENSATIONS, ONCALL_KINDS, ONCALL_STATUSES } from "@/domain/oncall";
import { isValidTime } from "@/domain/hours/schedule";
import { UserFacingError } from "@/lib/result";
import { isoDate } from "@/lib/validation";
import { getCurrentUser } from "../context";
import { db } from "../db";

const optionalTime = z.preprocess((v) => (v === "" ? null : v), z.string().refine(isValidTime, "Hora no válida (HH:MM).").nullable().optional());

export const onCallInputSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    startTime: optionalTime,
    endTime: optionalTime,
    kind: z.enum(ONCALL_KINDS),
    status: z.enum(ONCALL_STATUSES).default("PLANNED"),
    workedMinutes: z.number().int().min(0).max(24 * 60 * 31).default(0),
    compensation: z.enum(ONCALL_COMPENSATIONS).default("PENDING"),
    compensationDays: z.number().min(0).max(60).nullable().optional(),
    jiraIssueKey: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim().toUpperCase() : v),
      z.string().regex(/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/, "Clave de Jira no válida (p. ej. PROJ-123).").nullable().optional(),
    ),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { path: ["endDate"], message: "La fecha de fin no puede ser anterior a la de inicio." });

export async function listOnCall(year?: number) {
  const user = await getCurrentUser();
  return db.onCallShift.findMany({
    where: { userId: user.id, ...(year ? { startDate: { lte: `${year}-12-31` }, endDate: { gte: `${year}-01-01` } } : {}) },
    orderBy: { startDate: "desc" },
  });
}

function toData(input: z.infer<typeof onCallInputSchema>) {
  return {
    ...input,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    compensationDays: input.compensation === "DAYS" ? (input.compensationDays ?? null) : null,
    jiraIssueKey: input.jiraIssueKey ?? null,
    notes: input.notes || null,
  };
}

export async function saveOnCall(id: string | null, raw: unknown) {
  const input = onCallInputSchema.parse(raw);
  const user = await getCurrentUser();
  if (id) {
    const res = await db.onCallShift.updateMany({ where: { id, userId: user.id }, data: toData(input) });
    if (res.count === 0) throw new UserFacingError("La guardia ya no existe.");
    return;
  }
  await db.onCallShift.create({ data: { ...toData(input), userId: user.id } });
}

export async function deleteOnCall(id: string) {
  const user = await getCurrentUser();
  const res = await db.onCallShift.deleteMany({ where: { id, userId: user.id } });
  if (res.count === 0) throw new UserFacingError("La guardia ya no existe.");
}
