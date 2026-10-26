import "server-only";
/**
 * Opciones de días compensados ofrecidas por la empresa. Se guardan todas las
 * opciones y se marca cuáles se han elegido; elegir una crea una ausencia de
 * tipo "Compensado" (solo en MyTime, nunca en Jira).
 */
import { z } from "zod";
import { ACTIVE_STATUSES, findOverlaps, type AbsenceRecord } from "@/domain/absences";
import { formatRange } from "@/domain/dates";
import { UserFacingError } from "@/lib/result";
import { isoDate } from "@/lib/validation";
import { getCurrentUser } from "../context";
import { db } from "../db";
import { absenceToRecord } from "./absences";

const optionSchema = z
  .object({ startDate: isoDate, endDate: isoDate, label: z.string().trim().max(80).nullable().optional() })
  .refine((o) => o.startDate <= o.endDate, { message: "La fecha de fin no puede ser anterior a la de inicio." });

export const compensatoryGroupSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  name: z.string().trim().min(1, "Pon un nombre (p. ej. «Compensados 2026»).").max(80),
  pickCount: z.number().int().min(1).max(100).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  options: z.array(optionSchema).min(1, "Añade al menos una opción.").max(60),
});

const chooseSchema = z.object({
  optionId: z.string().min(1),
  status: z.enum(["PLANNED", "REQUESTED", "APPROVED", "TAKEN"]),
  allowOverlap: z.boolean().default(false),
});

export async function listCompensatoryGroups(year?: number) {
  const user = await getCurrentUser();
  return db.compensatoryGroup.findMany({
    where: { userId: user.id, ...(year ? { year } : {}) },
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    include: { options: { orderBy: { startDate: "asc" }, include: { absence: true } } },
  });
}
export type CompensatoryGroupRow = Awaited<ReturnType<typeof listCompensatoryGroups>>[number];

export async function createCompensatoryGroup(raw: unknown) {
  const input = compensatoryGroupSchema.parse(raw);
  const user = await getCurrentUser();
  const unique = new Map(input.options.map((o) => [`${o.startDate}|${o.endDate}`, o]));
  return db.compensatoryGroup.create({
    data: {
      userId: user.id,
      year: input.year,
      name: input.name,
      pickCount: input.pickCount ?? null,
      notes: input.notes ?? null,
      options: { create: [...unique.values()].map((o) => ({ startDate: o.startDate, endDate: o.endDate, label: o.label ?? null })) },
    },
  });
}

export async function deleteCompensatoryGroup(id: string) {
  const user = await getCurrentUser();
  // Las ausencias ya creadas se conservan: solo se borra el listado de opciones.
  const res = await db.compensatoryGroup.deleteMany({ where: { id, userId: user.id } });
  if (res.count === 0) throw new UserFacingError("El grupo ya no existe.");
}

async function ownedOption(optionId: string) {
  const user = await getCurrentUser();
  const option = await db.compensatoryOption.findFirst({
    where: { id: optionId, group: { userId: user.id } },
    include: { group: { include: { options: { include: { absence: true } } } }, absence: true },
  });
  if (!option) throw new UserFacingError("La opción ya no existe.");
  return { user, option };
}

export async function chooseCompensatoryOption(raw: unknown) {
  const input = chooseSchema.parse(raw);
  const { user, option } = await ownedOption(input.optionId);
  if (option.absence && ACTIVE_STATUSES.has(option.absence.status)) throw new UserFacingError("Esta opción ya está elegida.");

  const chosen = option.group.options.filter((o) => o.absence && ACTIVE_STATUSES.has(o.absence.status)).length;
  if (option.group.pickCount != null && chosen >= option.group.pickCount)
    throw new UserFacingError(`Ya has elegido ${chosen} de ${option.group.pickCount} opciones. Deshaz una antes de elegir otra.`);

  const candidate: AbsenceRecord = {
    id: "new", type: "COMPENSATORY", status: input.status,
    startDate: option.startDate, endDate: option.endDate, portion: "FULL", daysOverride: null,
  };
  const nearby = await db.absence.findMany({
    where: { userId: user.id, startDate: { lte: option.endDate }, endDate: { gte: option.startDate } },
  });
  const overlaps = findOverlaps(candidate, nearby.map(absenceToRecord));
  if (overlaps.length > 0 && !input.allowOverlap)
    throw new UserFacingError(`Esas fechas coinciden con otra ausencia (${formatRange(overlaps[0].startDate, overlaps[0].endDate)}). Confirma si quieres elegirla igualmente.`, { needsConfirmation: true });

  return db.$transaction(async (tx) => {
    const absence = await tx.absence.create({
      data: {
        userId: user.id, type: "COMPENSATORY", status: input.status,
        startDate: option.startDate, endDate: option.endDate, portion: "FULL",
        origin: "compensatory", notes: `Opción de «${option.group.name}»${option.label ? `: ${option.label}` : ""}`,
        events: { create: { toStatus: input.status, note: "Elegida entre las opciones de compensados" } },
      },
    });
    // Si había una ausencia anterior (rechazada/cancelada), se sustituye el vínculo.
    return tx.compensatoryOption.update({ where: { id: option.id }, data: { absenceId: absence.id } });
  });
}

/** Deshace la elección: elimina la ausencia vinculada y deja la opción disponible. */
export async function unchooseCompensatoryOption(optionId: string) {
  const { user, option } = await ownedOption(optionId);
  if (!option.absenceId) return;
  await db.absence.deleteMany({ where: { id: option.absenceId, userId: user.id } });
}
