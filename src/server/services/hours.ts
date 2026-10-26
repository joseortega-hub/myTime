import "server-only";
import { z } from "zod";
import { addDays, eachDay, isIsoDate, type IsoDate } from "@/domain/dates";
import { parseHoursText } from "@/domain/hours/parser";
import { expectedMinutes, type ScheduleDay } from "@/domain/hours/schedule";
import { createJiraAdapter } from "@/integrations/jira/adapters";
import { JiraError } from "@/integrations/jira/types";
import { UserFacingError, WithWarnings } from "@/lib/result";
import { scheduleSchema, timeEntryInputSchema, workItemInputSchema } from "@/lib/validation";
import { getCalendarContext, getCurrentUser, today } from "../context";
import { db } from "../db";
import { absenceToRecord } from "./absences";

export async function getSchedule(): Promise<ScheduleDay[]> {
  const user = await getCurrentUser();
  const rows = await db.workScheduleDay.findMany({ where: { userId: user.id }, orderBy: { weekday: "asc" } });
  return rows.map(({ weekday, startTime, endTime, breakMinutes }) => ({ weekday, startTime, endTime, breakMinutes }));
}

export async function updateSchedule(raw: unknown) {
  const days = scheduleSchema.parse(raw);
  const user = await getCurrentUser();
  await db.$transaction([
    db.workScheduleDay.deleteMany({ where: { userId: user.id } }),
    db.workScheduleDay.createMany({ data: days.map((d) => ({ ...d, userId: user.id })) }),
  ]);
}

export async function listWorkItems(includeInactive = false) {
  const user = await getCurrentUser();
  return db.workItem.findMany({
    where: { userId: user.id, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ active: "desc" }, { label: "asc" }],
  });
}

export async function saveWorkItem(id: string | null, raw: unknown) {
  const input = workItemInputSchema.parse(raw);
  const user = await getCurrentUser();
  const data = { ...input, projectName: input.projectName ?? null, jiraIssueKey: input.jiraIssueKey ?? null };
  if (id) {
    const res = await db.workItem.updateMany({ where: { id, userId: user.id }, data });
    if (res.count === 0) throw new UserFacingError("El proyecto ya no existe.");
    return;
  }
  await db.workItem.create({ data: { ...data, userId: user.id } });
}

export async function deleteWorkItem(id: string) {
  const user = await getCurrentUser();
  const used = await db.timeEntry.count({ where: { workItemId: id } });
  if (used > 0) {
    // Con horas registradas no se borra: se desactiva para conservar el histórico.
    await db.workItem.updateMany({ where: { id, userId: user.id }, data: { active: false } });
    return "deactivated" as const;
  }
  await db.workItem.deleteMany({ where: { id, userId: user.id } });
  return "deleted" as const;
}

async function dayContext(dates: IsoDate[]) {
  const { user, index } = await getCalendarContext();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const [schedule, absences, entries] = await Promise.all([
    getSchedule(),
    db.absence.findMany({ where: { userId: user.id, startDate: { lte: end }, endDate: { gte: start } } }),
    db.timeEntry.findMany({
      where: { userId: user.id, date: { gte: start, lte: end } },
      include: { workItem: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const records = absences.map(absenceToRecord);
  return { user, index, schedule, records, entries };
}

/** Semana (lunes a domingo) con horas esperadas, registradas y entradas. */
export async function getWeek(weekStart: IsoDate) {
  if (!isIsoDate(weekStart)) throw new UserFacingError("Fecha no válida.");
  const dates = eachDay(weekStart, addDays(weekStart, 6));
  const { index, schedule, records, entries } = await dayContext(dates);
  return dates.map((date) => {
    const dayEntries = entries.filter((e) => e.date === date);
    return {
      date,
      holiday: index.holidayOn(date) ?? null,
      working: index.isWorkingDay(date),
      expected: expectedMinutes(date, schedule, index, records),
      logged: dayEntries.reduce((s, e) => s + e.minutes, 0),
      entries: dayEntries,
    };
  });
}
export type WeekDay = Awaited<ReturnType<typeof getWeek>>[number];

export async function interpretText(text: string, referenceDate: IsoDate) {
  const t = z.string().trim().min(1, "Escribe o dicta tus horas.").max(2000).parse(text);
  if (!isIsoDate(referenceDate)) throw new UserFacingError("Fecha no válida.");
  const items = await listWorkItems();
  // Contexto de una ventana amplia: el texto puede hablar de "ayer" o "el lunes".
  const dates = eachDay(addDays(referenceDate, -40), addDays(referenceDate, 7));
  const { index, schedule, records, entries } = await dayContext(dates);
  return parseHoursText(t, {
    workItems: items.map((i) => ({ id: i.id, label: i.label, jiraIssueKey: i.jiraIssueKey, aliases: i.aliases })),
    referenceDate,
    expectedMinutesFor: (d) => expectedMinutes(d, schedule, index, records),
    loggedMinutesFor: (d) => entries.filter((e) => e.date === d).reduce((s, e) => s + e.minutes, 0),
  });
}

export async function createTimeEntries(raw: unknown) {
  const list = z.array(timeEntryInputSchema).min(1).max(50).parse(raw);
  const user = await getCurrentUser();
  const ids = [...new Set(list.map((e) => e.workItemId))];
  const owned = await db.workItem.count({ where: { id: { in: ids }, userId: user.id } });
  if (owned !== ids.length) throw new UserFacingError("Algún proyecto seleccionado no existe.");
  await db.timeEntry.createMany({
    data: list.map((e) => ({ ...e, description: e.description ?? null, userId: user.id })),
  });
  const warnings: string[] = [];
  if (list.some((e) => e.date > today())) warnings.push("Has registrado horas en una fecha futura.");
  return new WithWarnings(list.length, warnings);
}

export async function updateTimeEntry(id: string, raw: unknown) {
  const input = timeEntryInputSchema.parse(raw);
  const user = await getCurrentUser();
  const current = await db.timeEntry.findFirst({ where: { id, userId: user.id } });
  if (!current) throw new UserFacingError("El registro ya no existe.");
  if (current.syncStatus === "SYNCED")
    throw new UserFacingError("Este registro ya se envió a Jira. Corrígelo también en Jira; aquí no se puede editar para no desalinearlos.");
  await db.timeEntry.update({ where: { id }, data: { ...input, description: input.description ?? null, syncStatus: "LOCAL", syncError: null } });
}

export async function deleteTimeEntry(id: string) {
  const user = await getCurrentUser();
  const res = await db.timeEntry.deleteMany({ where: { id, userId: user.id } });
  if (res.count === 0) throw new UserFacingError("El registro ya no existe.");
}

/** Días laborables pasados recientes sin ninguna hora registrada. */
export async function daysMissingHours(lookbackDays = 10): Promise<IsoDate[]> {
  const end = addDays(today(), -1);
  const dates = eachDay(addDays(end, -lookbackDays + 1), end);
  const { index, schedule, records, entries } = await dayContext(dates);
  const hasItems = (await listWorkItems()).length > 0;
  if (!hasItems) return [];
  return dates.filter((d) => expectedMinutes(d, schedule, index, records) > 0 && !entries.some((e) => e.date === d));
}

/**
 * Envía a Jira las imputaciones seleccionadas. Solo funciona en modo simulado o
 * en modo real con JIRA_ENABLE_WORKLOG_WRITE=true. Cada envío es individual y
 * un registro ya enviado no se vuelve a enviar.
 */
export async function pushEntriesToJira(entryIds: string[]) {
  z.array(z.string()).min(1).max(100).parse(entryIds);
  const user = await getCurrentUser();
  const adapter = createJiraAdapter();
  if (adapter.mode === "disabled") throw new JiraError("not_configured");
  if (!adapter.writeEnabled) throw new JiraError("write_disabled");
  const entries = await db.timeEntry.findMany({
    where: { id: { in: entryIds }, userId: user.id, syncStatus: { not: "SYNCED" } },
    include: { workItem: true },
  });
  let sent = 0;
  const errors: string[] = [];
  for (const e of entries) {
    if (!e.workItem.jiraIssueKey) {
      await db.timeEntry.update({ where: { id: e.id }, data: { syncStatus: "ERROR", syncError: "El proyecto no tiene clave de Jira." } });
      errors.push(`${e.workItem.label}: sin clave de Jira.`);
      continue;
    }
    await db.timeEntry.update({ where: { id: e.id }, data: { syncStatus: "QUEUED" } });
    try {
      const { worklogId } = await adapter.addWorklog({ issueKey: e.workItem.jiraIssueKey, date: e.date, minutes: e.minutes, comment: e.description });
      await db.timeEntry.update({
        where: { id: e.id },
        data: { syncStatus: "SYNCED", externalWorklogId: worklogId, syncedAt: new Date(), syncError: null },
      });
      sent++;
    } catch (err) {
      const msg = err instanceof JiraError ? err.message : "Error desconocido al enviar.";
      await db.timeEntry.update({ where: { id: e.id }, data: { syncStatus: "ERROR", syncError: msg } });
      errors.push(msg);
      if (err instanceof JiraError && (err.kind === "auth" || err.kind === "write_disabled")) break;
    }
  }
  await db.syncRun.create({
    data: {
      provider: "jira", kind: "worklogs", mode: adapter.mode,
      status: errors.length === 0 ? "SUCCESS" : sent > 0 ? "PARTIAL" : "ERROR",
      created: sent, errorMessage: errors[0]?.slice(0, 300) ?? null, finishedAt: new Date(),
    },
  });
  const warnings = adapter.mode === "mock" ? ["Modo SIMULADO: no se ha enviado nada a ningún servidor."] : [];
  if (errors.length > 0) warnings.push(...[...new Set(errors)].slice(0, 3));
  return new WithWarnings({ sent, failed: entries.length - sent }, warnings);
}
