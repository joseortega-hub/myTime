import { describe, expect, it } from "vitest";
import { generateAlerts, DEFAULT_ALERT_RULES } from "@/domain/alerts";
import { CalendarIndex } from "@/domain/calendar";
import { parseHoursText, type ParseContext } from "@/domain/hours/parser";
import { DEFAULT_SCHEDULE, expectedMinutes } from "@/domain/hours/schedule";
import { availabilitySeries, coverageAlerts, findLowConcentrationWindows, type TeamAbsenceRecord } from "@/domain/team";
import { mapPublicHolidays } from "@/integrations/holidays/public-holidays";
import { resolveSpanishRegion } from "@/integrations/holidays/spain-regions";

const calendar = new CalendarIndex({
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [{ date: "2026-11-02", name: "Festivo", scope: "LOCAL" }],
});

describe("disponibilidad del equipo", () => {
  const members = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, displayName: `Persona demo ${i}`, teamId: "t", isDemo: true }));
  const absences: TeamAbsenceRecord[] = [
    { id: "a", personId: "p1", startDate: "2026-11-09", endDate: "2026-11-13", portion: "FULL", status: "CONFIRMED" },
    { id: "b", personId: "p2", startDate: "2026-11-11", endDate: "2026-11-12", portion: "FULL", status: "CONFIRMED" },
    { id: "c", personId: "p3", startDate: "2026-11-12", endDate: "2026-11-12", portion: "FULL", status: "TENTATIVE" },
    // Duplicado de la misma persona: no debe contar dos veces
    { id: "d", personId: "p1", startDate: "2026-11-10", endDate: "2026-11-10", portion: "FULL", status: "CONFIRMED" },
  ];
  const series = availabilitySeries({ members, absences, start: "2026-11-09", end: "2026-11-20", calendar, minPresent: 2 });

  it("14. cuenta ausencias simultáneas por día sin duplicar personas", () => {
    const d10 = series.find((d) => d.date === "2026-11-10")!;
    expect(d10.absent).toBe(1);
    const d12 = series.find((d) => d.date === "2026-11-12")!;
    expect(d12.absent).toBe(2);
    expect(d12.tentative).toBe(1);
    expect(d12.coverage).toBe("warning");
  });

  it("14. genera alertas de cobertura agrupadas", () => {
    const alerts = coverageAlerts(series);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].start).toBe("2026-11-11");
  });

  it("encuentra los periodos con menos ausencias", () => {
    const w = findLowConcentrationWindows(series, 3);
    expect(w[0].personDays).toBe(0);
    expect(w[0].start >= "2026-11-16").toBe(true);
  });
});

describe("horas: jornada", () => {
  it("usa el horario L-J 8-18 y V 8-15", () => {
    expect(expectedMinutes("2026-10-26", DEFAULT_SCHEDULE, calendar, [])).toBe(540);
    expect(expectedMinutes("2026-10-30", DEFAULT_SCHEDULE, calendar, [])).toBe(420);
    expect(expectedMinutes("2026-10-31", DEFAULT_SCHEDULE, calendar, [])).toBe(0);
    expect(expectedMinutes("2026-11-02", DEFAULT_SCHEDULE, calendar, [])).toBe(0);
  });

  it("descuenta ausencias aprobadas (media jornada = mitad)", () => {
    const half = [{ id: "x", type: "VACATION" as const, status: "APPROVED" as const, startDate: "2026-10-27", endDate: "2026-10-27", portion: "MORNING" as const }];
    expect(expectedMinutes("2026-10-27", DEFAULT_SCHEDULE, calendar, half)).toBe(270);
    const pending = [{ ...half[0], status: "REQUESTED" as const, portion: "FULL" as const }];
    expect(expectedMinutes("2026-10-27", DEFAULT_SCHEDULE, calendar, pending)).toBe(540);
  });
});

describe("horas: intérprete de texto", () => {
  const ctx: ParseContext = {
    referenceDate: "2026-10-28", // miércoles
    workItems: [
      { id: "alfa", label: "Proyecto Alfa", jiraIssueKey: "ALFA-12", aliases: ["alfa"] },
      { id: "soporte", label: "Soporte", jiraIssueKey: "OPS-7", aliases: ["incidencias"] },
      { id: "daily", label: "Reuniones", jiraIssueKey: null, aliases: ["daily", "reunión"] },
      { id: "formacion", label: "Formación", jiraIssueKey: "RRHH-3", aliases: [] },
    ],
    expectedMinutesFor: () => 600,
    loggedMinutesFor: () => 0,
  };

  it("interpreta horas, claves Jira, alias y el resto del día", () => {
    const r = parseHoursText("4h en ALFA-12 login, 2h30 incidencias y el resto formación", ctx);
    expect(r.entries.map((e) => [e.workItemId, e.minutes])).toEqual([
      ["alfa", 240],
      ["soporte", 150],
      ["formacion", 210],
    ]);
    expect(r.entries[0].description).toBe("Login");
    expect(r.entries.every((e) => e.confidence === "high")).toBe(true);
  });

  it("entiende expresiones habladas y fechas relativas", () => {
    const r = parseHoursText("ayer dos horas y media de daily y media hora en soporte", ctx);
    expect(r.date).toBe("2026-10-27");
    expect(r.dateDetected).toBe(true);
    expect(r.entries.map((e) => [e.workItemId, e.minutes])).toEqual([
      ["daily", 150],
      ["soporte", 30],
    ]);
  });

  it("entiende rangos horarios y días de la semana", () => {
    const r = parseHoursText("el lunes de 8 a 12 en alfa; de 12:00 a 15:30 soporte", ctx);
    expect(r.date).toBe("2026-10-26");
    expect(r.entries.map((e) => e.minutes)).toEqual([240, 210]);
  });

  it("admite decimales con coma", () => {
    const r = parseHoursText("1,5 horas alfa", ctx);
    expect(r.entries[0].minutes).toBe(90);
  });

  it("tolera un error de transcripción en el alias", () => {
    const r = parseHoursText("3h formacon", ctx);
    expect(r.entries[0].workItemId).toBe("formacion");
    expect(r.entries[0].confidence).toBe("medium");
  });

  it("marca como dudosos los proyectos desconocidos o claves no configuradas", () => {
    const r = parseHoursText("2h en XYZ-99, 1h en algo raro", ctx);
    expect(r.entries[0].issueKey).toBe("XYZ-99");
    expect(r.entries[0].workItemId).toBeNull();
    expect(r.entries[1].confidence).toBe("low");
    expect(r.entries[1].issues.join()).toMatch(/No se ha reconocido/);
  });

  it("avisa cuando se supera la jornada", () => {
    const r = parseHoursText("11h alfa", ctx);
    expect(r.warnings.join()).toMatch(/supera/);
  });
});

describe("festivos públicos", () => {
  const data = [
    { date: "2026-01-01", localName: "Año Nuevo", name: "New Year", countryCode: "ES", global: true, counties: null, types: ["Public"] },
    { date: "2026-03-19", localName: "San José", name: "St Joseph", countryCode: "ES", global: false, counties: ["ES-VC", "ES-MC"], types: ["Public"] },
    { date: "2026-09-11", localName: "Diada", name: "Diada", countryCode: "ES", global: false, counties: ["ES-CT"], types: ["Public"] },
    { date: "2026-05-04", localName: "Banco", name: "Bank", countryCode: "ES", global: true, counties: null, types: ["Bank"] },
  ];

  it("traduce provincia a comunidad autónoma", () => {
    expect(resolveSpanishRegion("Alicante")?.code).toBe("ES-VC");
    expect(resolveSpanishRegion("comunitat valenciana")?.code).toBe("ES-VC");
    expect(resolveSpanishRegion("Atlántida")).toBeNull();
  });

  it("incluye nacionales y los de la región, y nada más", () => {
    const h = mapPublicHolidays(data, "ES-VC");
    expect(h.map((x) => [x.date, x.scope])).toEqual([
      ["2026-01-01", "NATIONAL"],
      ["2026-03-19", "REGIONAL"],
    ]);
  });
});

describe("alertas", () => {
  it("avisa de vacaciones, festivos y solicitudes pendientes próximas", () => {
    const alerts = generateAlerts({
      today: "2026-10-26",
      rules: DEFAULT_ALERT_RULES,
      absences: [
        { id: "1", type: "VACATION", status: "APPROVED", startDate: "2026-11-02", endDate: "2026-11-06", portion: "FULL" },
        { id: "2", type: "VACATION", status: "REQUESTED", startDate: "2026-10-30", endDate: "2026-10-30", portion: "FULL" },
        { id: "3", type: "VACATION", status: "REJECTED", startDate: "2026-10-29", endDate: "2026-10-29", portion: "FULL" },
      ],
      holidays: [{ date: "2026-11-01", name: "Todos los Santos", scope: "NATIONAL" }],
      vacationBalance: null,
      teamOverlaps: [],
      calendarComplete: true,
      daysMissingHours: [],
    });
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain("upcoming_absence");
    expect(kinds).toContain("pending_request");
    expect(kinds).toContain("upcoming_holiday");
    expect(alerts.filter((a) => a.key.includes(":3:"))).toHaveLength(0);
  });
});

describe("horas: descripción", () => {
  it("conserva tildes y mayúsculas del texto original", () => {
    const r = parseHoursText("2h30 en alfa revisión de código con María", {
      referenceDate: "2026-10-28",
      workItems: [{ id: "alfa", label: "Alfa", jiraIssueKey: null, aliases: [] }],
      expectedMinutesFor: () => 540,
      loggedMinutesFor: () => 0,
    });
    expect(r.entries[0].description).toBe("Revisión de código con María");
  });
});
