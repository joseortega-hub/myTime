import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_RULES, generateAlerts, pendingPushes, reminderStage, type AlertInput } from "@/domain/alerts";
import { addMonths, closingWindow, dayRequestState, firstRequestableDate, isWithinLeadTime, requestDeadline } from "@/domain/deadlines";
import { summarizeOnCall } from "@/domain/oncall";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/lib/session";

describe("plazo de 3 meses para pedir vacaciones", () => {
  it("resta meses ajustando el fin de mes", () => {
    expect(addMonths("2026-11-30", -3)).toBe("2026-08-30");
    expect(addMonths("2027-05-31", -3)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
    expect(requestDeadline("2027-01-26")).toBe("2026-10-26");
  });

  it("sabe qué días siguen en plazo", () => {
    expect(isWithinLeadTime("2027-01-26", "2026-10-26")).toBe(true);
    expect(isWithinLeadTime("2027-01-25", "2026-10-26")).toBe(false);
    expect(firstRequestableDate("2026-10-26")).toBe("2027-01-26");
  });

  it("detecta el mes que se está cerrando: «te quedas sin tiempo»", () => {
    const w = closingWindow("2026-10-26");
    expect(w).toMatchObject({ year: 2027, month: 1, firstRequestable: "2027-01-26", lastDeadline: "2026-10-31", daysLeft: 5 });
  });

  it("clasifica cada día para el mapa", () => {
    expect(dayRequestState("2026-10-20", "2026-10-26")).toBe("past");
    expect(dayRequestState("2026-12-15", "2026-10-26")).toBe("closed");
    expect(dayRequestState("2027-01-30", "2026-10-26")).toBe("closing");
    expect(dayRequestState("2027-06-01", "2026-10-26")).toBe("open");
  });
});

const base = (p: Partial<AlertInput> = {}): AlertInput => ({
  today: "2026-10-26",
  rules: DEFAULT_ALERT_RULES,
  absences: [],
  holidays: [],
  vacationBalance: null,
  teamOverlaps: [],
  calendarComplete: true,
  daysMissingHours: [],
  ...p,
});

describe("recordatorios una semana y un día antes", () => {
  it("calcula la etapa del recordatorio", () => {
    expect(reminderStage(9, [7, 1])).toBeNull();
    expect(reminderStage(7, [7, 1])).toBe(7);
    expect(reminderStage(3, [7, 1])).toBe(7);
    expect(reminderStage(1, [7, 1])).toBe(1);
    expect(reminderStage(0, [7, 1])).toBe(1);
    expect(reminderStage(-1, [7, 1])).toBeNull();
  });

  it("festivos: un aviso a 7 días y otro distinto el día antes", () => {
    const holidays = [{ date: "2026-11-02", name: "Festivo", scope: "LOCAL" as const }];
    const week = generateAlerts(base({ today: "2026-10-26", holidays })).filter((a) => a.kind === "upcoming_holiday");
    const dayBefore = generateAlerts(base({ today: "2026-11-01", holidays })).filter((a) => a.kind === "upcoming_holiday");
    expect(week).toHaveLength(1);
    expect(dayBefore).toHaveLength(1);
    expect(week[0].key).not.toBe(dayBefore[0].key);
    expect(dayBefore[0].title).toMatch(/mañana/);
    expect(generateAlerts(base({ today: "2026-10-20", holidays })).some((a) => a.kind === "upcoming_holiday")).toBe(false);
  });

  it("compensados: avisos a 7 días y el día antes, también si están pendientes", () => {
    const absences = [{ id: "c1", type: "COMPENSATORY" as const, status: "REQUESTED" as const, startDate: "2026-11-02", endDate: "2026-11-02", portion: "FULL" as const }];
    const a = generateAlerts(base({ today: "2026-10-27", absences })).find((x) => x.kind === "upcoming_compensatory");
    expect(a?.title).toBe("Día compensado en 6 días");
    expect(a?.push).toBe(true);
    const rejected = [{ ...absences[0], status: "REJECTED" as const }];
    expect(generateAlerts(base({ today: "2026-11-01", absences: rejected })).some((x) => x.kind === "upcoming_compensatory")).toBe(false);
  });

  it("guardias: aviso el día antes", () => {
    const onCall = [{ id: "g1", startDate: "2026-10-27", endDate: "2026-10-28", kind: "ON_CALL" as const, startTime: "18:00" }];
    const a = generateAlerts(base({ onCall })).find((x) => x.kind === "upcoming_oncall");
    expect(a?.title).toBe("Guardia mañana");
    expect(a?.description).toMatch(/18:00/);
  });
});

describe("cierre semanal de Jira (jueves y viernes)", () => {
  const week = { expectedMinutes: 2580, loggedMinutes: 1800, unsyncedEntries: 3, jiraWriteEnabled: false };
  it("avisa el jueves y el viernes, con claves distintas", () => {
    const thu = generateAlerts(base({ today: "2026-10-29", week })).find((a) => a.kind === "weekly_jira");
    const fri = generateAlerts(base({ today: "2026-10-30", week })).find((a) => a.kind === "weekly_jira");
    expect(thu?.title).toMatch(/Mañana es viernes/);
    expect(fri?.title).toMatch(/Hoy es viernes/);
    expect(fri?.severity).toBe("critical");
    expect(thu?.description).toMatch(/3 registros sin imputar/);
    expect(thu?.key).not.toBe(fri?.key);
  });
  it("no avisa otros días ni si se desactiva", () => {
    expect(generateAlerts(base({ today: "2026-10-28", week })).some((a) => a.kind === "weekly_jira")).toBe(false);
    expect(generateAlerts(base({ today: "2026-10-29", week, rules: { ...DEFAULT_ALERT_RULES, weeklyJiraClose: false } })).some((a) => a.kind === "weekly_jira")).toBe(false);
  });
});

describe("avisos de plazo y envío al móvil", () => {
  it("avisa de que te quedas sin tiempo y lo envía al móvil cuando queda una semana o menos", () => {
    const a = generateAlerts(base()).find((x) => x.kind === "request_deadline");
    expect(a?.title).toMatch(/Te quedas sin tiempo para pedir vacaciones en enero/);
    expect(a?.severity).toBe("critical");
    expect(a?.push).toBe(true);
  });

  it("avisa de vacaciones planificadas cuyo plazo vence", () => {
    const absences = [{ id: "p1", type: "VACATION" as const, status: "PLANNED" as const, startDate: "2027-02-01", endDate: "2027-02-05", portion: "FULL" as const }];
    const a = generateAlerts(base({ today: "2026-10-26", absences })).find((x) => x.kind === "planned_deadline");
    expect(a?.title).toMatch(/Pide ya/);
  });

  it("no repite recordatorios ya enviados", () => {
    const alerts = generateAlerts(base({ holidays: [{ date: "2026-10-27", name: "F", scope: "LOCAL" }] }));
    const first = pendingPushes(alerts, new Set());
    expect(first.length).toBeGreaterThan(0);
    expect(pendingPushes(alerts, new Set(first.map((a) => a.key)))).toHaveLength(0);
  });
});

describe("guardias", () => {
  it("resume guardias del año", () => {
    const s = summarizeOnCall(
      [
        { id: "1", startDate: "2026-03-02", endDate: "2026-03-08", kind: "ON_CALL", status: "DONE", workedMinutes: 180, compensation: "DAYS", compensationDays: 1 },
        { id: "2", startDate: "2026-11-02", endDate: "2026-11-02", kind: "ON_SITE", status: "PLANNED", workedMinutes: 0, compensation: "PENDING", compensationDays: null },
        { id: "3", startDate: "2026-05-02", endDate: "2026-05-02", kind: "ON_SITE", status: "CANCELLED", workedMinutes: 0, compensation: "NONE", compensationDays: null },
        { id: "4", startDate: "2026-06-01", endDate: "2026-06-01", kind: "REMOTE", status: "DONE", workedMinutes: 60, compensation: "PENDING", compensationDays: null },
      ],
      2026,
      "2026-10-26",
    );
    expect(s).toEqual({ shifts: 3, days: 9, workedMinutes: 240, compensationDays: 1, pendingCompensation: 1, upcoming: 1 });
  });
});

describe("sesión para producción", () => {
  const secret = "x".repeat(40);
  it("firma y verifica la cookie, y rechaza manipulaciones y caducadas", async () => {
    const t = await createSessionToken(secret, 1_000);
    expect(await verifySessionToken(t, secret, 2_000)).toBe(true);
    expect(await verifySessionToken(t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), secret, 2_000)).toBe(false);
    expect(await verifySessionToken(t, "y".repeat(40), 2_000)).toBe(false);
    expect(await verifySessionToken(t, secret, 1_000 + 31 * 86_400_000)).toBe(false);
    expect(await verifySessionToken(undefined, secret)).toBe(false);
  });
  it("compara contraseñas", async () => {
    expect(await passwordMatches("abc", "abc")).toBe(true);
    expect(await passwordMatches("abd", "abc")).toBe(false);
    expect(await passwordMatches("", "")).toBe(false);
  });
});
