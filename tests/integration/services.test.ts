/**
 * Pruebas de integración de los servicios contra PostgreSQL (esquema "test").
 * Requieren `docker compose up -d`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createAbsence, changeAbsenceStatus, getBalances, upsertBalance, deleteAbsence, listAbsences } from "@/server/services/absences";
import { addHoliday, importHolidaysFile, setYearVerified } from "@/server/services/calendar";
import { chooseCompensatoryOption, createCompensatoryGroup, listCompensatoryGroups, unchooseCompensatoryOption } from "@/server/services/compensatory";
import { buildExport, importData } from "@/server/services/data-transfer";
import { createTimeEntries, getWeek, interpretText, pushEntriesToJira, saveWorkItem, listWorkItems } from "@/server/services/hours";
import { syncMyAbsences } from "@/server/services/integrations";
import { deletePlan, runOptimizer, savePlan } from "@/server/services/planning";
import { clearDemoData, seedDemoTeam, listTeams } from "@/server/services/team";
import { WithWarnings } from "@/lib/result";

const unwrap = <T>(r: T | WithWarnings<T>): T => (r instanceof WithWarnings ? r.data : r);

async function reset() {
  if (!process.env.DATABASE_URL?.includes("schema=test")) throw new Error("Las pruebas solo pueden usar el esquema de pruebas.");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'test' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"test"."${t.tablename}"`).join(", ")} CASCADE`);
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await db.$disconnect();
});

const vac = (p: Record<string, unknown> = {}) => ({ type: "VACATION", status: "APPROVED", startDate: "2026-11-02", endDate: "2026-11-06", portion: "FULL", ...p });

describe("ausencias y saldo (persistencia)", () => {
  it("crea el perfil y el calendario en el primer acceso, incluso con peticiones simultáneas", async () => {
    await Promise.all([listAbsences(), listAbsences(), getWeek("2026-10-26")]);
    expect(await db.userProfile.count()).toBe(1);
    expect(await db.workCalendar.count()).toBe(1);
    expect(await db.workScheduleDay.count()).toBe(5);
  });

  it("9. rechaza duplicados exactos", async () => {
    await createAbsence(vac());
    await expect(createAbsence(vac())).rejects.toThrow(/idéntica/);
  });

  it("10. pide confirmación ante solapamientos y lo permite si se confirma", async () => {
    await createAbsence(vac());
    await expect(createAbsence(vac({ startDate: "2026-11-05", endDate: "2026-11-10" }))).rejects.toMatchObject({ options: { needsConfirmation: true } });
    const r = await createAbsence(vac({ startDate: "2026-11-05", endDate: "2026-11-10", allowOverlap: true }));
    expect(r.warnings.join()).toMatch(/una vez/);
  });

  it("valida en el servidor (fechas invertidas, media jornada de varios días)", async () => {
    await expect(createAbsence(vac({ startDate: "2026-11-06", endDate: "2026-11-02" }))).rejects.toThrow();
    await expect(createAbsence(vac({ portion: "MORNING" }))).rejects.toThrow();
    await expect(createAbsence({ ...vac(), type: "INVENTADO" })).rejects.toThrow();
  });

  it("7/8/11. el saldo solo descuenta aprobadas y respeta los festivos", async () => {
    await upsertBalance({ year: 2026, absenceType: "VACATION", allocatedDays: 23, carryOverDays: 2, source: "OFFICIAL" });
    await addHoliday({ date: "2026-11-02", name: "Festivo local", scope: "LOCAL" });
    await createAbsence(vac()); // 4 días (el 2 es festivo)
    await createAbsence(vac({ status: "REQUESTED", startDate: "2026-12-14", endDate: "2026-12-15" }));
    await createAbsence(vac({ status: "REJECTED", startDate: "2026-12-16", endDate: "2026-12-18" }));
    const b = (await getBalances(2026)).find((x) => x.type === "VACATION")!;
    expect(b.consumed).toBe(4);
    expect(b.requested).toBe(2);
    expect(b.available).toBe(21);
    expect(b.exact).toBe(false); // calendario sin confirmar
    await setYearVerified(2026, true);
    expect((await getBalances(2026)).find((x) => x.type === "VACATION")!.exact).toBe(true);
  });

  it("registra el historial de estados y no reactiva rechazadas que solapan", async () => {
    const a = unwrap(await createAbsence(vac({ status: "REQUESTED" })));
    await changeAbsenceStatus({ id: a.id, status: "REJECTED" });
    await createAbsence(vac({ startDate: "2026-11-04", endDate: "2026-11-04" }));
    await expect(changeAbsenceStatus({ id: a.id, status: "REQUESTED" })).rejects.toThrow(/Coincide/);
    const events = await db.absenceEvent.findMany({ where: { absenceId: a.id } });
    expect(events.map((e) => e.toStatus).sort()).toEqual(["REJECTED", "REQUESTED"]);
    await deleteAbsence(a.id);
    expect(await db.absenceEvent.count({ where: { absenceId: a.id } })).toBe(0);
  });
});

describe("festivos e importaciones", () => {
  it("15. rechaza archivos de festivos inválidos sin escribir nada", async () => {
    await expect(importHolidaysFile("f.csv", "2026-13-45;Mal;local")).rejects.toThrow(/no válid/i);
    await expect(importHolidaysFile("f.json", "{no es json")).rejects.toThrow(/JSON/);
    await expect(importHolidaysFile("f.json", JSON.stringify([{ date: "2026-01-01", name: "", scope: "LOCAL" }]))).rejects.toThrow();
    expect(await db.holiday.count()).toBe(0);
  });

  it("importa CSV y omite fechas repetidas", async () => {
    const csv = "fecha;nombre;ambito\n2026-06-24;Hogueras;local\n2026-06-24;Duplicado;local\n2026-10-09;Comunitat;autonómico";
    expect(await importHolidaysFile("alicante.csv", csv)).toEqual({ created: 2, skipped: 1 });
  });

  it("15. rechaza copias de seguridad inválidas y hace ida y vuelta con una válida", async () => {
    await expect(importData("[]")).rejects.toThrow(/formato/);
    await expect(importData("no-json")).rejects.toThrow(/JSON/);
    await createAbsence(vac());
    await saveWorkItem(null, { label: "Alfa", jiraIssueKey: "ALFA-1", aliases: ["alfa"] });
    const item = (await listWorkItems())[0];
    await createTimeEntries([{ date: "2026-10-26", workItemId: item.id, minutes: 120, description: "x" }]);
    const backup = JSON.stringify(await buildExport());
    const again = await importData(backup);
    expect(again.data.absences).toBe(0); // todo duplicado
    await reset();
    const fresh = await importData(backup);
    expect(fresh.data).toMatchObject({ absences: 1, workItems: 1, timeEntries: 1 });
  });
});

describe("compensados", () => {
  it("guarda las opciones, respeta el máximo a elegir y permite deshacer", async () => {
    await createCompensatoryGroup({
      year: 2026,
      name: "Compensados 2026",
      pickCount: 1,
      options: [{ startDate: "2026-12-07", endDate: "2026-12-07" }, { startDate: "2026-12-24", endDate: "2026-12-24" }],
    });
    const [g] = await listCompensatoryGroups();
    await chooseCompensatoryOption({ optionId: g.options[0].id, status: "APPROVED" });
    await expect(chooseCompensatoryOption({ optionId: g.options[1].id, status: "APPROVED" })).rejects.toThrow(/1 de 1/);
    const abs = await db.absence.findMany({ where: { type: "COMPENSATORY" } });
    expect(abs).toHaveLength(1);
    await unchooseCompensatoryOption(g.options[0].id);
    const [after] = await listCompensatoryGroups();
    expect(after.options.every((o) => o.absenceId === null)).toBe(true);
    expect(after.options).toHaveLength(2); // las opciones se conservan
  });
});

describe("optimizador y planificaciones", () => {
  it("12. calcula con datos guardados y guarda propuestas como planificadas sin descontar", async () => {
    await upsertBalance({ year: 2026, absenceType: "VACATION", allocatedDays: 10, carryOverDays: 0, source: "MANUAL" });
    await addHoliday({ date: "2026-12-08", name: "Inmaculada", scope: "NATIONAL" });
    const r = await runOptimizer({ year: 2026, range: { start: "2026-11-01", end: "2026-12-31" }, daysToSpend: 3 });
    expect(r.availableDays).toBe(10);
    const best = r.alternatives[0];
    const plan = await savePlan({ year: 2026, name: "Puentes", objective: best.objective, score: best.score, blocks: best.blocks });
    const planned = await db.absence.findMany({ where: { planId: plan.id } });
    expect(planned.every((a) => a.status === "PLANNED")).toBe(true);
    const b = (await getBalances(2026)).find((x) => x.type === "VACATION")!;
    expect(b.available).toBe(10);
    expect(b.planned).toBe(3);
    await expect(savePlan({ year: 2026, name: "Otra vez", objective: best.objective, score: best.score, blocks: best.blocks })).rejects.toThrow(/ya tiene/);
    await deletePlan(plan.id);
    expect(await db.absence.count()).toBe(0);
  });

  it("14. tiene en cuenta al equipo de demostración", async () => {
    await seedDemoTeam();
    const [team] = await listTeams();
    expect(team.isDemo).toBe(true);
    expect(team.members.every((m) => m.displayName.startsWith("Persona demo"))).toBe(true);
    const r = await runOptimizer({ year: 2026, range: { start: "2026-11-01", end: "2026-12-31" }, daysToSpend: 3, avoidTeamOverlap: true, teamId: team.id });
    expect(r.alternatives.length).toBeGreaterThan(0);
    await clearDemoData();
    expect(await db.team.count()).toBe(0);
  });
});

describe("horas", () => {
  it("interpreta texto con los proyectos guardados y calcula la jornada", async () => {
    await saveWorkItem(null, { label: "Alfa", jiraIssueKey: "ALFA-1", aliases: ["alfa"] });
    await saveWorkItem(null, { label: "Soporte", aliases: ["incidencias"] });
    const r = await interpretText("4h alfa y el resto incidencias", "2026-10-30"); // viernes: 7 h
    expect(r.entries.map((e) => e.minutes)).toEqual([240, 180]);
    const week = await getWeek("2026-10-26");
    expect(week.map((d) => d.expected)).toEqual([540, 540, 540, 540, 420, 0, 0]);
  });

  it("16/17. no envía a Jira si la integración no está configurada; en simulado marca como enviado", async () => {
    await saveWorkItem(null, { label: "Alfa", jiraIssueKey: "ALFA-1", aliases: [] });
    const [item] = await listWorkItems();
    await createTimeEntries([{ date: "2026-10-26", workItemId: item.id, minutes: 60 }]);
    const [entry] = await db.timeEntry.findMany();
    await expect(pushEntriesToJira([entry.id])).rejects.toMatchObject({ kind: "not_configured" });
    process.env.JIRA_MODE = "mock";
    try {
      const r = await pushEntriesToJira([entry.id]);
      expect(r.data.sent).toBe(1);
      expect(r.warnings.join()).toMatch(/SIMULADO/);
      expect((await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).syncStatus).toBe("SYNCED");
    } finally {
      process.env.JIRA_MODE = "disabled";
    }
  });
});

describe("sincronización con Jira simulado", () => {
  it("crea, no duplica y registra cada ejecución", async () => {
    await expect(syncMyAbsences(2026)).rejects.toMatchObject({ kind: "not_configured" });
    process.env.JIRA_MODE = "mock";
    try {
      expect((await syncMyAbsences(2026)).data).toMatchObject({ created: 3 });
      expect((await syncMyAbsences(2026)).data).toMatchObject({ created: 0, unchanged: 3 });
      expect(await db.absence.count({ where: { externalSource: "jira-mock" } })).toBe(3);
      expect(await db.syncRun.count({ where: { status: "SUCCESS" } })).toBe(2);
    } finally {
      process.env.JIRA_MODE = "disabled";
    }
  });
});

describe("guardias y avisos al móvil", () => {
  it("valida y guarda guardias", async () => {
    const { saveOnCall, listOnCall } = await import("@/server/services/oncall");
    await expect(saveOnCall(null, { startDate: "2026-11-05", endDate: "2026-11-01", kind: "ON_CALL" })).rejects.toThrow();
    await saveOnCall(null, { startDate: "2026-11-02", endDate: "2026-11-08", kind: "ON_CALL", compensation: "DAYS", compensationDays: 1, jiraIssueKey: "guard-1" });
    const [g] = await listOnCall(2026);
    expect(g.jiraIssueKey).toBe("GUARD-1");
  });

  it("envía cada recordatorio una sola vez y elimina dispositivos caducados", async () => {
    const { saveSubscription, runReminders } = await import("@/server/services/notifications");
    await addHoliday({ date: "2026-10-30", name: "Festivo de prueba", scope: "LOCAL" });
    await saveSubscription({ endpoint: "https://push.example.test/ok", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });
    await saveSubscription({ endpoint: "https://push.example.test/gone", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });
    const sent: string[] = [];
    const sender = async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push(JSON.parse(payload).title);
    };
    const first = await runReminders({ date: "2026-10-29", sender }); // jueves, festivo mañana
    expect(sent).toEqual(expect.arrayContaining(["Festivo mañana: Festivo de prueba", "Mañana es viernes: revisa tus imputaciones en Jira"]));
    expect(await db.pushSubscription.count()).toBe(1);
    const again = await runReminders({ date: "2026-10-29", sender });
    expect(again.due).toBe(0);
    expect(first.due).toBeGreaterThan(0);
  });

  it("el endpoint del programador exige el secreto", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    process.env.CRON_SECRET = "s".repeat(32);
    try {
      expect((await GET(new Request("http://localhost/api/cron/reminders"))).status).toBe(401);
      expect((await GET(new Request("http://localhost/api/cron/reminders", { headers: { Authorization: "Bearer mal" } }))).status).toBe(401);
      const ok = await GET(new Request("http://localhost/api/cron/reminders", { headers: { Authorization: `Bearer ${"s".repeat(32)}` } }));
      // Sin claves VAPID y sin dispositivos no se envía nada, pero la llamada es válida.
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, pushConfigured: false });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
