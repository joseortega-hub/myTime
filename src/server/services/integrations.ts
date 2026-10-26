import "server-only";
import { endOfYear, startOfYear } from "@/domain/dates";
import { createJiraAdapter } from "@/integrations/jira/adapters";
import { publicStatus } from "@/integrations/jira/config";
import { syncExternalAbsences, type ExternalAbsenceStore } from "@/integrations/jira/sync";
import { JiraError } from "@/integrations/jira/types";
import { WithWarnings } from "@/lib/result";
import { getCurrentUser } from "../context";
import { db } from "../db";

export const JIRA_SOURCE = "jira";

export function getJiraStatus() {
  return publicStatus();
}

export async function lastSyncRuns(limit = 10) {
  return db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}

export async function testJiraConnection() {
  return createJiraAdapter().checkConnection();
}

function prismaStore(userId: string, source: string): ExternalAbsenceStore {
  return {
    async listExternal(src, range) {
      const rows = await db.absence.findMany({
        where: { userId, externalSource: src, startDate: { lte: range.end }, endDate: { gte: range.start } },
      });
      return rows.map((r) => ({
        id: r.id, externalId: r.externalId!, type: r.type, status: r.status, startDate: r.startDate,
        endDate: r.endDate, portion: r.portion, updatedAt: r.externalUpdatedAt?.toISOString() ?? null,
      }));
    },
    async create(src, a, syncedAt) {
      await db.absence.create({
        data: {
          userId, type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate, portion: a.portion,
          origin: "jira", externalSource: src, externalId: a.externalId, lastSyncedAt: syncedAt,
          externalUpdatedAt: a.updatedAt ? new Date(a.updatedAt) : null,
          events: { create: { toStatus: a.status, note: `Sincronizada desde ${source}` } },
        },
      });
    },
    async update(id, a, syncedAt) {
      const cur = await db.absence.findUniqueOrThrow({ where: { id } });
      await db.absence.update({
        where: { id },
        data: {
          type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate, portion: a.portion,
          lastSyncedAt: syncedAt, externalUpdatedAt: a.updatedAt ? new Date(a.updatedAt) : null,
          ...(cur.status !== a.status ? { events: { create: { fromStatus: cur.status, toStatus: a.status, note: "Cambio detectado en la fuente" } } } : {}),
        },
      });
    },
    async markRemoved(id, syncedAt) {
      const cur = await db.absence.findUniqueOrThrow({ where: { id } });
      await db.absence.update({
        where: { id },
        data: { status: "CANCELLED", lastSyncedAt: syncedAt, events: { create: { fromStatus: cur.status, toStatus: "CANCELLED", note: "Ya no aparece en la fuente" } } },
      });
    },
    async touch(id, syncedAt) {
      await db.absence.update({ where: { id }, data: { lastSyncedAt: syncedAt } });
    },
  };
}

/** Lee las ausencias propias de Jira (o del simulador) y las sincroniza. Nunca escribe en Jira. */
export async function syncMyAbsences(year: number) {
  const adapter = createJiraAdapter();
  if (adapter.mode === "disabled") throw new JiraError("not_configured");
  const user = await getCurrentUser();
  const range = { start: startOfYear(year), end: endOfYear(year) };
  const source = adapter.mode === "mock" ? "jira-mock" : JIRA_SOURCE;
  const run = await db.syncRun.create({ data: { provider: "jira", kind: "absences", mode: adapter.mode, status: "RUNNING" } });
  try {
    const incoming = await adapter.listMyAbsences(range);
    const counts = await syncExternalAbsences(source, incoming, prismaStore(user.id, source), range);
    await db.syncRun.update({ where: { id: run.id }, data: { ...counts, status: "SUCCESS", finishedAt: new Date() } });
    const warnings = adapter.mode === "mock" ? ["Datos SIMULADOS: no proceden de ningún Jira real."] : [];
    return new WithWarnings(counts, warnings);
  } catch (e) {
    const msg = e instanceof JiraError ? e.message : "Error inesperado durante la sincronización.";
    await db.syncRun.update({ where: { id: run.id }, data: { status: "ERROR", errorMessage: msg.slice(0, 300), finishedAt: new Date() } });
    throw e;
  }
}
