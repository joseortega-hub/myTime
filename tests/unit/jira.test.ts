import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DisabledJiraAdapter, LiveJiraAdapter, MockJiraAdapter } from "@/integrations/jira/adapters";
import { loadJiraConfig, publicStatus, validateLiveConfig } from "@/integrations/jira/config";
import { JiraHttpClient } from "@/integrations/jira/http-client";
import { groupWorklogsToAbsences, jiraMappingSchema, mapIssueToAbsence, type JiraMapping } from "@/integrations/jira/mapping";
import { syncExternalAbsences, type ExternalAbsenceStore, type StoredExternalAbsence } from "@/integrations/jira/sync";
import { JiraError, type ExternalAbsence } from "@/integrations/jira/types";

const SECRET = "tok_SUPER_SECRETO_123";

const issueMapping = jiraMappingSchema.parse({
  strategy: "issue",
  jql: "project = AUS",
  fields: { startDate: "customfield_1", endDate: "customfield_2", absenceType: "customfield_3" },
  typeValues: { Compensado: "COMPENSATORY" },
  statusValues: { Aprobada: "APPROVED", Pendiente: "REQUESTED" },
}) as Extract<JiraMapping, { strategy: "issue" }>;

function jsonResponse(body: unknown, status = 200, type = "application/json") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

const liveCfg = {
  ...loadJiraConfig({}),
  mode: "live" as const,
  baseUrl: "https://jira.example.test",
  token: SECRET,
};

describe("17. ausencia de configuración de Jira", () => {
  it("por defecto la integración está desactivada y no hace llamadas", async () => {
    const cfg = loadJiraConfig({});
    expect(cfg.mode).toBe("disabled");
    const adapter = new DisabledJiraAdapter();
    await expect(adapter.listMyAbsences()).rejects.toMatchObject({ kind: "not_configured" });
    expect((await adapter.checkConnection()).ok).toBe(false);
  });

  it("el modo real exige URL https y token", () => {
    expect(validateLiveConfig({ ...liveCfg, baseUrl: null, token: null })).toHaveLength(2);
    expect(validateLiveConfig({ ...liveCfg, baseUrl: "http://jira.example.test" })[0]).toMatch(/https/);
    expect(() => new LiveJiraAdapter({ ...liveCfg, token: null }, issueMapping)).toThrow(JiraError);
  });

  it("el mapeo de ejemplo del repositorio es válido pero solo contiene marcadores", () => {
    const example = JSON.parse(readFileSync("config/jira-mapping.example.json", "utf8"));
    expect(jiraMappingSchema.safeParse(example).success).toBe(true);
    expect(JSON.stringify(example)).toMatch(/<customfield_/);
  });
});

describe("16. errores de integración con Jira", () => {
  const cases: [number | "network" | "timeout" | "html", string][] = [
    [401, "auth"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [503, "server"],
    ["network", "network"],
    ["timeout", "timeout"],
    ["html", "auth"],
  ];
  for (const [input, kind] of cases) {
    it(`clasifica ${input} como ${kind}`, async () => {
      const fetchImpl = vi.fn(async () => {
        if (input === "network") throw new TypeError("fetch failed");
        if (input === "timeout") throw Object.assign(new Error("t"), { name: "TimeoutError" });
        if (input === "html") return jsonResponse("<html>login</html>", 200, "text/html");
        return jsonResponse({ errorMessages: [`detalle con ${SECRET}`] }, input);
      });
      const client = new JiraHttpClient({ baseUrl: "https://jira.example.test", token: SECRET, authMethod: "pat", timeoutMs: 1000, fetchImpl: fetchImpl as typeof fetch });
      const err = (await client.get("/rest/api/2/myself").catch((e: unknown) => e)) as JiraError;
      expect(err).toBeInstanceOf(JiraError);
      expect(err.kind).toBe(kind);
      // 18. El mensaje de error nunca contiene el token ni el cuerpo de la respuesta.
      expect(err.message).not.toContain(SECRET);
    });
  }

  it("solo permite rutas de la API REST", async () => {
    const client = new JiraHttpClient({ baseUrl: "https://jira.example.test", token: SECRET, authMethod: "pat", timeoutMs: 1000, fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(client.get("/login.jsp")).rejects.toBeInstanceOf(JiraError);
  });

  it("no escribe imputaciones si la escritura no está habilitada", async () => {
    const fetchImpl = vi.fn();
    const adapter = new LiveJiraAdapter({ ...liveCfg, writeEnabled: false }, issueMapping, fetchImpl as unknown as typeof fetch);
    await expect(adapter.addWorklog({ issueKey: "ABC-1", date: "2026-10-26", minutes: 60, comment: null })).rejects.toMatchObject({ kind: "write_disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no consulta ausencias de compañeros sin permiso explícito", async () => {
    const adapter = new LiveJiraAdapter(liveCfg, issueMapping, vi.fn() as unknown as typeof fetch);
    await expect(adapter.listTeamAbsences()).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("lee solicitudes con el adaptador real usando el mapeo (fetch simulado)", async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.toString()).toContain("/rest/api/2/search");
      return jsonResponse({
        issues: [
          { id: "1", key: "AUS-1", fields: { customfield_1: "2026-08-03", customfield_2: "2026-08-07", status: { name: "Aprobada" } } },
          { id: "2", key: "AUS-2", fields: { customfield_1: "2026-12-28", customfield_2: "2026-12-30", status: { name: "Borrador" } } },
        ],
      });
    });
    const adapter = new LiveJiraAdapter(liveCfg, issueMapping, fetchImpl as unknown as typeof fetch);
    const res = await adapter.listMyAbsences({ start: "2026-01-01", end: "2026-12-31" });
    expect(res).toEqual([expect.objectContaining({ externalId: "AUS-1", status: "APPROVED", startDate: "2026-08-03" })]);
    const headers = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
  });
});

describe("mapeo de campos", () => {
  it("convierte una incidencia y su tipo", () => {
    const a = mapIssueToAbsence(
      { id: "1", key: "AUS-9", fields: { customfield_1: "2026-11-13T00:00:00.000+0100", customfield_2: null, customfield_3: { value: "Compensado" }, status: { name: "Pendiente" } } },
      issueMapping,
    );
    expect(a).toMatchObject({ type: "COMPENSATORY", status: "REQUESTED", startDate: "2026-11-13", endDate: "2026-11-13" });
  });

  it("falla con un error claro si faltan las fechas", () => {
    expect(() => mapIssueToAbsence({ id: "1", key: "AUS-9", fields: { status: { name: "Pendiente" } } }, issueMapping)).toThrow(/fechas/);
  });

  it("agrupa imputaciones diarias en ausencias", () => {
    const m = jiraMappingSchema.parse({ strategy: "worklog", issueKeys: { "VAC-1": "VACATION" } }) as Extract<JiraMapping, { strategy: "worklog" }>;
    const day = (d: string, h: number, id: string) => ({ id, issueKey: "VAC-1", started: `${d}T08:00:00.000+0200`, timeSpentSeconds: h * 3600 });
    const res = groupWorklogsToAbsences([day("2026-08-03", 8, "1"), day("2026-08-04", 8, "2"), day("2026-08-06", 4, "3"), { ...day("2026-08-07", 8, "4"), issueKey: "OTRA-1" }], m);
    expect(res.map((r) => [r.startDate, r.endDate, r.portion])).toEqual([
      ["2026-08-03", "2026-08-04", "FULL"],
      ["2026-08-06", "2026-08-06", "MORNING"],
    ]);
  });
});

describe("sincronización", () => {
  function memoryStore(initial: StoredExternalAbsence[] = []) {
    const rows = new Map(initial.map((r) => [r.id, { ...r }]));
    let n = 0;
    const store: ExternalAbsenceStore = {
      listExternal: async () => [...rows.values()],
      create: async (_s, a) => void rows.set(`new${++n}`, { ...a, id: `new${n}` }),
      update: async (id, a) => void rows.set(id, { ...a, id }),
      markRemoved: async (id) => void rows.set(id, { ...rows.get(id)!, status: "CANCELLED" }),
      touch: async () => {},
    };
    return { store, rows };
  }
  const range = { start: "2026-01-01", end: "2026-12-31" };
  const a = (id: string, p: Partial<ExternalAbsence> = {}): ExternalAbsence => ({ externalId: id, type: "VACATION", status: "APPROVED", startDate: "2026-08-03", endDate: "2026-08-07", portion: "FULL", updatedAt: null, ...p });

  it("crea, evita duplicados, actualiza y detecta eliminados", async () => {
    const { store, rows } = memoryStore();
    expect(await syncExternalAbsences("jira", [a("X-1"), a("X-1"), a("X-2")], store, range)).toEqual({ created: 2, updated: 0, removed: 0, unchanged: 0 });
    expect(rows.size).toBe(2);
    const second = await syncExternalAbsences("jira", [a("X-1", { status: "TAKEN" })], store, range);
    expect(second).toEqual({ created: 0, updated: 1, removed: 1, unchanged: 0 });
    expect([...rows.values()].find((r) => r.externalId === "X-2")?.status).toBe("CANCELLED");
    const third = await syncExternalAbsences("jira", [a("X-1", { status: "TAKEN" })], store, range);
    expect(third).toEqual({ created: 0, updated: 0, removed: 0, unchanged: 1 });
  });

  it("el adaptador simulado devuelve datos marcados como simulados", async () => {
    const m = new MockJiraAdapter();
    const res = await m.listMyAbsences(range);
    expect(res.every((r) => r.externalId.startsWith("SIM-"))).toBe(true);
    const team = await m.listTeamAbsences("T", range);
    expect(team.every((t) => t.personDisplayName.includes("simulada"))).toBe(true);
    await expect(new MockJiraAdapter({ failWith: new JiraError("network") }).listMyAbsences(range)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("18. protección de secretos", () => {
  it("el estado público no expone el token", () => {
    const status = publicStatus({ ...liveCfg, mappingFile: "no-existe.json" });
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(status.tokenConfigured).toBe(true);
  });

  it(".env está ignorado y .env.example no contiene credenciales", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
    expect(gitignore).toMatch(/config\/jira-mapping\.json/);
    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^JIRA_TOKEN=""$/m);
    expect(example).toMatch(/^JIRA_BASE_URL=""$/m);
    expect(example).toMatch(/^JIRA_MODE="disabled"$/m);
  });

  it("ningún módulo de cliente lee variables de entorno de Jira", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("src/components").map((f) => readFileSync(`src/components/${f}`, "utf8"));
    for (const f of files) {
      expect(f).not.toMatch(/process\.env/);
      expect(f).not.toMatch(/JIRA_TOKEN/);
    }
  });
});
