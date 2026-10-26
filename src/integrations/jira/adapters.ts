import "server-only";
/**
 * Implementaciones de los puertos de Jira:
 * - DisabledJiraAdapter: no hace nada; cualquier operación avisa de que no hay configuración.
 * - MockJiraAdapter: datos SIMULADOS y deterministas, sin red. Para pruebas y demostraciones.
 * - LiveJiraAdapter: API REST real. Solo se crea con configuración explícita.
 */
import { z } from "zod";
import { addDays, isIsoDate, type IsoDate } from "@/domain/dates";
import { loadJiraConfig, loadMapping, validateLiveConfig, type JiraConfig } from "./config";
import { JiraHttpClient } from "./http-client";
import { groupWorklogsToAbsences, mapIssueToAbsence, type JiraIssue, type JiraMapping, type JiraWorklog } from "./mapping";
import {
  JiraError,
  type AbsenceSource,
  type ConnectionInfo,
  type ExternalAbsence,
  type ExternalTeamAbsence,
  type WorklogSink,
  type WorklogToWrite,
} from "./types";

export type JiraAdapter = AbsenceSource & WorklogSink;

export class DisabledJiraAdapter implements JiraAdapter {
  readonly mode = "disabled" as const;
  readonly writeEnabled = false;
  async checkConnection(): Promise<ConnectionInfo> {
    return { ok: false, accountDisplayName: null, message: "Integración desactivada (JIRA_MODE=disabled)." };
  }
  async listMyAbsences(): Promise<ExternalAbsence[]> {
    throw new JiraError("not_configured");
  }
  async listTeamAbsences(): Promise<ExternalTeamAbsence[]> {
    throw new JiraError("not_configured");
  }
  async addWorklog(): Promise<{ worklogId: string }> {
    throw new JiraError("not_configured");
  }
}

/** Datos simulados: claves SIM-*, nombres "Persona simulada N". */
export class MockJiraAdapter implements JiraAdapter {
  readonly mode = "mock" as const;
  readonly writeEnabled = true;
  readonly written: WorklogToWrite[] = [];

  constructor(private readonly opts: { failWith?: JiraError } = {}) {}

  private guard() {
    if (this.opts.failWith) throw this.opts.failWith;
  }

  async checkConnection(): Promise<ConnectionInfo> {
    this.guard();
    return { ok: true, accountDisplayName: "Usuario simulado", message: "Conexión SIMULADA: no se ha contactado con ningún servidor." };
  }

  async listMyAbsences(range: { start: IsoDate; end: IsoDate }): Promise<ExternalAbsence[]> {
    this.guard();
    const year = Number(range.start.slice(0, 4));
    const all: ExternalAbsence[] = [
      { externalId: `SIM-${year}-1`, type: "VACATION", status: "APPROVED", startDate: `${year}-08-10`, endDate: `${year}-08-14`, portion: "FULL", updatedAt: `${year}-06-01T10:00:00.000Z` },
      { externalId: `SIM-${year}-2`, type: "VACATION", status: "REQUESTED", startDate: `${year}-12-28`, endDate: `${year}-12-30`, portion: "FULL", updatedAt: `${year}-10-01T10:00:00.000Z` },
      { externalId: `SIM-${year}-3`, type: "COMPENSATORY", status: "APPROVED", startDate: `${year}-11-13`, endDate: `${year}-11-13`, portion: "FULL", updatedAt: `${year}-10-05T10:00:00.000Z` },
    ];
    return all.filter((a) => a.startDate <= range.end && a.endDate >= range.start);
  }

  async listTeamAbsences(teamKey: string, range: { start: IsoDate; end: IsoDate }): Promise<ExternalTeamAbsence[]> {
    this.guard();
    const out: ExternalTeamAbsence[] = [];
    for (let i = 1; i <= 3; i++) {
      const start = addDays(range.start, i * 9);
      if (start > range.end) break;
      out.push({
        externalId: `SIM-TEAM-${teamKey}-${i}`,
        personExternalId: `sim-person-${i}`,
        personDisplayName: `Persona simulada ${i}`,
        startDate: start,
        endDate: addDays(start, i + 1),
        status: i === 3 ? "TENTATIVE" : "CONFIRMED",
      });
    }
    return out;
  }

  async addWorklog(worklog: WorklogToWrite): Promise<{ worklogId: string }> {
    this.guard();
    this.written.push(worklog);
    return { worklogId: `SIM-WL-${this.written.length}` };
  }
}

const searchResponse = z.object({
  issues: z.array(z.object({ id: z.string(), key: z.string(), fields: z.record(z.string(), z.unknown()) })),
  total: z.number().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});
const worklogResponse = z.object({
  worklogs: z.array(
    z.object({
      id: z.string(),
      started: z.string(),
      timeSpentSeconds: z.number(),
      updated: z.string().optional(),
      author: z.object({ name: z.string().optional(), accountId: z.string().optional(), key: z.string().optional() }).optional(),
    }),
  ),
});
const myselfResponse = z.object({
  displayName: z.string().optional(),
  name: z.string().optional(),
  key: z.string().optional(),
  accountId: z.string().optional(),
});

export class LiveJiraAdapter implements JiraAdapter {
  readonly mode = "live" as const;
  readonly writeEnabled: boolean;
  private readonly http: JiraHttpClient;

  constructor(
    cfg: JiraConfig,
    private readonly mapping: JiraMapping,
    fetchImpl?: typeof fetch,
  ) {
    const problems = validateLiveConfig(cfg);
    if (problems.length > 0) throw new JiraError("not_configured", problems.join(" "));
    this.writeEnabled = cfg.writeEnabled;
    this.http = new JiraHttpClient({
      baseUrl: cfg.baseUrl!,
      token: cfg.token!,
      authMethod: cfg.authMethod,
      timeoutMs: cfg.timeoutMs,
      fetchImpl,
    });
  }

  async checkConnection(): Promise<ConnectionInfo> {
    const raw = await this.http.get<unknown>("/rest/api/2/myself");
    const me = myselfResponse.safeParse(raw);
    if (!me.success) throw new JiraError("invalid_response");
    return { ok: true, accountDisplayName: me.data.displayName ?? null, message: "Conexión correcta (solo lectura)." };
  }

  async listMyAbsences(range: { start: IsoDate; end: IsoDate }): Promise<ExternalAbsence[]> {
    if (this.mapping.strategy === "issue") {
      const m = this.mapping;
      // El filtro por fechas se aplica después de mapear: la sintaxis JQL de los
      // campos personalizados depende de la instancia y aún no se conoce.
      const jql = `(${m.jql}) ORDER BY updated DESC`;
      const out: ExternalAbsence[] = [];
      for (let startAt = 0; startAt < 1000; startAt += 100) {
        const raw = await this.http.get<unknown>("/rest/api/2/search", {
          jql,
          startAt,
          maxResults: 100,
          fields: ["status", "updated", m.fields.startDate, m.fields.endDate, m.fields.absenceType].filter(Boolean).join(","),
        });
        const page = searchResponse.safeParse(raw);
        if (!page.success) throw new JiraError("invalid_response");
        for (const issue of page.data.issues) {
          const a = mapIssueToAbsence(issue as JiraIssue, m);
          if (a && a.startDate <= range.end && a.endDate >= range.start) out.push(a);
        }
        if (page.data.issues.length < 100) break;
      }
      return out;
    }

    // Estrategia "worklog": imputaciones del usuario actual en las tareas configuradas.
    const me = myselfResponse.parse(await this.http.get<unknown>("/rest/api/2/myself"));
    const logs: JiraWorklog[] = [];
    for (const issueKey of Object.keys(this.mapping.issueKeys)) {
      const raw = await this.http.get<unknown>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`);
      const parsed = worklogResponse.safeParse(raw);
      if (!parsed.success) throw new JiraError("invalid_response");
      for (const w of parsed.data.worklogs) {
        const author = w.author;
        const mine = author && ((me.accountId && author.accountId === me.accountId) || (me.key && author.key === me.key) || (me.name && author.name === me.name));
        const date = w.started.slice(0, 10);
        if (!mine || !isIsoDate(date) || date < range.start || date > range.end) continue;
        logs.push({ id: w.id, issueKey, started: w.started, timeSpentSeconds: w.timeSpentSeconds, updated: w.updated });
      }
    }
    return groupWorklogsToAbsences(logs, this.mapping);
  }

  async listTeamAbsences(): Promise<ExternalTeamAbsence[]> {
    // No se asume que ver una tarea autoriza a consultar las ausencias de todo el equipo.
    throw new JiraError("forbidden", "La consulta de ausencias del equipo requiere un permiso explícito que aún no está definido.");
  }

  async addWorklog(worklog: WorklogToWrite): Promise<{ worklogId: string }> {
    if (!this.writeEnabled) throw new JiraError("write_disabled");
    const raw = await this.http.post<unknown>(`/rest/api/2/issue/${encodeURIComponent(worklog.issueKey)}/worklog`, {
      started: `${worklog.date}T09:00:00.000+0000`,
      timeSpentSeconds: worklog.minutes * 60,
      comment: worklog.comment ?? undefined,
    });
    const parsed = z.object({ id: z.string() }).safeParse(raw);
    if (!parsed.success) throw new JiraError("invalid_response");
    return { worklogId: parsed.data.id };
  }
}

export function createJiraAdapter(cfg: JiraConfig = loadJiraConfig()): JiraAdapter {
  if (cfg.mode === "mock") return new MockJiraAdapter();
  if (cfg.mode === "live") return new LiveJiraAdapter(cfg, loadMapping(cfg));
  return new DisabledJiraAdapter();
}
