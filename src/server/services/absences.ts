import "server-only";
import {
  ABSENCE_STATUS_LABEL,
  ABSENCE_TYPE_LABEL,
  BALANCE_TYPES,
  computeConsumption,
  findDuplicate,
  findOverlaps,
  type AbsenceRecord,
  type AbsenceStatus,
  type AbsenceType,
} from "@/domain/absences";
import { computeBalance, type BalanceSummary } from "@/domain/balance";
import { calendarCompleteness } from "@/domain/calendar";
import { endOfYear, formatDate, formatRange, startOfYear } from "@/domain/dates";
import { UserFacingError, WithWarnings } from "@/lib/result";
import { isWithinLeadTime, requestDeadline } from "@/domain/deadlines";
import { absenceInputSchema, alertRulesSchema, balanceInputSchema, statusChangeSchema } from "@/lib/validation";
import { getCalendarContext, getCurrentUser, today } from "../context";
import { db } from "../db";

export type AbsenceRow = Awaited<ReturnType<typeof listAbsences>>[number];

export async function listAbsences(filter: { year?: number; status?: AbsenceStatus; type?: AbsenceType } = {}) {
  const user = await getCurrentUser();
  return db.absence.findMany({
    where: {
      userId: user.id,
      status: filter.status,
      type: filter.type,
      ...(filter.year
        ? { startDate: { lte: endOfYear(filter.year) }, endDate: { gte: startOfYear(filter.year) } }
        : {}),
    },
    orderBy: [{ startDate: "desc" }],
    include: { events: { orderBy: { at: "desc" }, take: 20 } },
  });
}

function toRecord(a: { id: string; type: AbsenceType; status: AbsenceStatus; startDate: string; endDate: string; portion: AbsenceRecord["portion"]; daysOverride: number | null }): AbsenceRecord {
  return { id: a.id, type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate, portion: a.portion, daysOverride: a.daysOverride };
}

async function checkConflicts(candidate: AbsenceRecord, allowOverlap: boolean) {
  const user = await getCurrentUser();
  const nearby = await db.absence.findMany({
    where: { userId: user.id, startDate: { lte: candidate.endDate }, endDate: { gte: candidate.startDate } },
  });
  const records = nearby.map(toRecord);
  const dup = findDuplicate(candidate, records);
  if (dup) {
    throw new UserFacingError(
      `Ya existe una ausencia idéntica (${ABSENCE_TYPE_LABEL[dup.type]}, ${formatRange(dup.startDate, dup.endDate)}, ${ABSENCE_STATUS_LABEL[dup.status].toLowerCase()}).`,
    );
  }
  const overlaps = findOverlaps(candidate, records);
  if (overlaps.length > 0 && !allowOverlap) {
    const list = overlaps.map((o) => `${ABSENCE_TYPE_LABEL[o.type]} ${formatRange(o.startDate, o.endDate)}`).join("; ");
    throw new UserFacingError(`Coincide con otra ausencia: ${list}. Confirma si quieres guardarla igualmente.`, { needsConfirmation: true });
  }
  return overlaps;
}

export async function createAbsence(raw: unknown) {
  const input = absenceInputSchema.parse(raw);
  const user = await getCurrentUser();
  const candidate: AbsenceRecord = { id: "new", ...input, daysOverride: input.daysOverride ?? null };
  const overlaps = await checkConflicts(candidate, input.allowOverlap);
  const { index } = await getCalendarContext();
  const consumption = computeConsumption(candidate, index);

  const created = await db.absence.create({
    data: {
      userId: user.id,
      type: input.type,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      portion: input.portion,
      daysOverride: input.daysOverride ?? null,
      notes: input.notes ?? null,
      events: { create: { toStatus: input.status, note: "Creada" } },
    },
  });
  const warnings: string[] = [];
  if (overlaps.length > 0) warnings.push("Guardada aunque coincide con otra ausencia: los días comunes solo se descuentan una vez.");
  if (consumption.total === 0) warnings.push("Este periodo no incluye días laborables: no consume saldo.");
  if (input.type === "VACATION" && (input.status === "REQUESTED" || input.status === "PLANNED")) {
    const prefs = (user.preferences ?? {}) as { alerts?: unknown };
    const lead = alertRulesSchema.partial().safeParse(prefs.alerts).data?.vacationLeadMonths ?? 3;
    if (!isWithinLeadTime(input.startDate, today(), lead))
      warnings.push(`Se pide con menos de ${lead} meses de antelación (el plazo era hasta el ${formatDate(requestDeadline(input.startDate, lead))}).`);
  }
  return new WithWarnings(created, warnings);
}

export async function updateAbsence(id: string, raw: unknown) {
  const input = absenceInputSchema.parse(raw);
  const user = await getCurrentUser();
  const current = await db.absence.findFirst({ where: { id, userId: user.id } });
  if (!current) throw new UserFacingError("La ausencia ya no existe.");
  const candidate: AbsenceRecord = { id, ...input, daysOverride: input.daysOverride ?? null };
  await checkConflicts(candidate, input.allowOverlap);
  return db.absence.update({
    where: { id },
    data: {
      type: input.type,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      portion: input.portion,
      daysOverride: input.daysOverride ?? null,
      notes: input.notes ?? null,
      ...(current.status !== input.status
        ? { events: { create: { fromStatus: current.status, toStatus: input.status, note: "Editada" } } }
        : {}),
    },
  });
}

export async function changeAbsenceStatus(raw: unknown) {
  const { id, status, note } = statusChangeSchema.parse(raw);
  const user = await getCurrentUser();
  const current = await db.absence.findFirst({ where: { id, userId: user.id } });
  if (!current) throw new UserFacingError("La ausencia ya no existe.");
  if (current.status === status) return current;
  // Reactivar una ausencia rechazada/cancelada puede crear solapamientos.
  if (current.status === "REJECTED" || current.status === "CANCELLED") {
    await checkConflicts({ ...toRecord(current), status }, false);
  }
  return db.absence.update({
    where: { id },
    data: { status, events: { create: { fromStatus: current.status, toStatus: status, note: note ?? null } } },
  });
}

export async function deleteAbsence(id: string) {
  const user = await getCurrentUser();
  const res = await db.absence.deleteMany({ where: { id, userId: user.id } });
  if (res.count === 0) throw new UserFacingError("La ausencia ya no existe.");
}

// ── Saldos ──────────────────────────────────────────────────

export async function upsertBalance(raw: unknown) {
  const input = balanceInputSchema.parse(raw);
  const user = await getCurrentUser();
  return db.annualBalance.upsert({
    where: { userId_year_absenceType: { userId: user.id, year: input.year, absenceType: input.absenceType } },
    update: { allocatedDays: input.allocatedDays, carryOverDays: input.carryOverDays, source: input.source, notes: input.notes ?? null },
    create: { userId: user.id, ...input, notes: input.notes ?? null },
  });
}

export async function deleteBalance(year: number, absenceType: AbsenceType) {
  const user = await getCurrentUser();
  await db.annualBalance.deleteMany({ where: { userId: user.id, year, absenceType } });
}

export async function getBalances(year: number): Promise<BalanceSummary[]> {
  const { user, rules, index } = await getCalendarContext();
  const [configs, absences] = await Promise.all([
    db.annualBalance.findMany({ where: { userId: user.id, year } }),
    db.absence.findMany({
      where: { userId: user.id, startDate: { lte: endOfYear(year) }, endDate: { gte: startOfYear(year) } },
    }),
  ]);
  const complete = calendarCompleteness(rules, year).complete;
  const now = today();
  return BALANCE_TYPES.map((type) => {
    const c = configs.find((x) => x.absenceType === type);
    return computeBalance({
      year,
      type,
      config: c ? { allocatedDays: c.allocatedDays, carryOverDays: c.carryOverDays, source: c.source } : null,
      absences: absences.map(toRecord),
      calendar: index,
      today: now,
      calendarComplete: complete,
    });
  });
}

export async function listBalanceConfigs() {
  const user = await getCurrentUser();
  return db.annualBalance.findMany({ where: { userId: user.id }, orderBy: [{ year: "desc" }, { absenceType: "asc" }] });
}

export { toRecord as absenceToRecord };
