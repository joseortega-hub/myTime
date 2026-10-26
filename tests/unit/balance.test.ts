import { describe, expect, it } from "vitest";
import { computeConsumption, findDuplicate, findOverlaps, type AbsenceRecord } from "@/domain/absences";
import { computeBalance } from "@/domain/balance";
import { CalendarIndex } from "@/domain/calendar";

const cal = new CalendarIndex({
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [
    { date: "2026-12-08", name: "Inmaculada", scope: "NATIONAL" },
    { date: "2026-12-25", name: "Navidad", scope: "NATIONAL" },
    { date: "2027-01-01", name: "Año Nuevo", scope: "NATIONAL" },
  ],
});

let n = 0;
function abs(p: Partial<AbsenceRecord> & Pick<AbsenceRecord, "startDate" | "endDate">): AbsenceRecord {
  return { id: `a${++n}`, type: "VACATION", status: "APPROVED", portion: "FULL", daysOverride: null, ...p };
}

const config = { allocatedDays: 23, carryOverDays: 0, source: "MANUAL" as const };

function balance(absences: AbsenceRecord[], today = "2026-10-26", year = 2026) {
  return computeBalance({ year, type: "VACATION", config, absences, calendar: cal, today, calendarComplete: true });
}

describe("consumo de ausencias", () => {
  it("5. ausencias que abarcan varios meses", () => {
    const c = computeConsumption(abs({ startDate: "2026-11-30", endDate: "2026-12-11" }), cal);
    expect(c.total).toBe(9); // 10 laborables menos el 8 de diciembre
  });

  it("6. ausencias que abarcan dos años se reparten por año", () => {
    const c = computeConsumption(abs({ startDate: "2026-12-28", endDate: "2027-01-08" }), cal);
    expect(c.byYear.get(2026)).toBe(4); // 28-31 dic
    expect(c.byYear.get(2027)).toBe(5); // 4-8 ene (el 1 es festivo)
    expect(c.total).toBe(9);
  });

  it("cuenta medias jornadas como 0,5", () => {
    expect(computeConsumption(abs({ startDate: "2026-11-03", endDate: "2026-11-03", portion: "MORNING" }), cal).total).toBe(0.5);
  });

  it("usa los días indicados por el usuario cuando existen", () => {
    expect(computeConsumption(abs({ startDate: "2026-11-02", endDate: "2026-11-06", daysOverride: 3 }), cal).total).toBe(3);
  });
});

describe("saldo", () => {
  it("11. calcula el disponible con aprobadas y disfrutadas", () => {
    const b = balance([
      abs({ startDate: "2026-08-03", endDate: "2026-08-14" }), // 10, pasado → disfrutado
      abs({ startDate: "2026-11-02", endDate: "2026-11-06" }), // 5, futuro → pendiente de disfrutar
    ]);
    expect(b.enjoyed).toBe(10);
    expect(b.approvedUpcoming).toBe(5);
    expect(b.available).toBe(8);
    expect(b.exact).toBe(true);
  });

  it("7. no descuenta solicitudes pendientes", () => {
    const b = balance([abs({ startDate: "2026-11-02", endDate: "2026-11-06", status: "REQUESTED" })]);
    expect(b.available).toBe(23);
    expect(b.requested).toBe(5);
    expect(b.availableIfRequestsApproved).toBe(18);
  });

  it("8. no descuenta solicitudes rechazadas ni planificadas", () => {
    const b = balance([
      abs({ startDate: "2026-11-02", endDate: "2026-11-06", status: "REJECTED" }),
      abs({ startDate: "2026-11-09", endDate: "2026-11-10", status: "PLANNED" }),
    ]);
    expect(b.available).toBe(23);
    expect(b.planned).toBe(2);
    expect(b.consumed).toBe(0);
  });

  it("9. no descuenta dos veces el mismo día aunque haya registros duplicados", () => {
    const b = balance([
      abs({ startDate: "2026-11-02", endDate: "2026-11-06" }),
      abs({ startDate: "2026-11-02", endDate: "2026-11-06", status: "TAKEN" }),
      abs({ startDate: "2026-11-05", endDate: "2026-11-09" }),
    ]);
    expect(b.consumed).toBe(6); // 2-6 y 9 de noviembre
  });

  it("mañana + tarde del mismo día cuentan como un día", () => {
    const b = balance([
      abs({ startDate: "2026-11-03", endDate: "2026-11-03", portion: "MORNING" }),
      abs({ startDate: "2026-11-03", endDate: "2026-11-03", portion: "AFTERNOON" }),
    ]);
    expect(b.consumed).toBe(1);
  });

  it("solo descuenta la parte del año consultado", () => {
    const xmas = abs({ startDate: "2026-12-28", endDate: "2027-01-08" });
    expect(balance([xmas]).consumed).toBe(4);
    expect(balance([xmas], "2026-10-26", 2027).consumed).toBe(5);
  });

  it("no inventa el disponible si no hay saldo configurado", () => {
    const b = computeBalance({ year: 2026, type: "VACATION", config: null, absences: [], calendar: cal, today: "2026-10-26", calendarComplete: true });
    expect(b.available).toBeNull();
    expect(b.configured).toBe(false);
    expect(b.warnings.join(" ")).toMatch(/no es posible calcular/);
  });

  it("marca el cálculo como no exacto si el saldo es estimado o el calendario incompleto", () => {
    const est = computeBalance({ year: 2026, type: "VACATION", config: { ...config, source: "ESTIMATED" }, absences: [], calendar: cal, today: "2026-10-26", calendarComplete: true });
    expect(est.exact).toBe(false);
    const inc = computeBalance({ year: 2026, type: "VACATION", config, absences: [], calendar: cal, today: "2026-10-26", calendarComplete: false });
    expect(inc.exact).toBe(false);
  });

  it("no mezcla tipos de ausencia", () => {
    const b = balance([abs({ startDate: "2026-11-02", endDate: "2026-11-02", type: "COMPENSATORY" })]);
    expect(b.consumed).toBe(0);
  });
});

describe("solapamientos y duplicados", () => {
  const existing = [
    abs({ startDate: "2026-11-02", endDate: "2026-11-06" }),
    abs({ startDate: "2026-11-20", endDate: "2026-11-20", portion: "MORNING" }),
    abs({ startDate: "2026-12-01", endDate: "2026-12-02", status: "REJECTED" }),
  ];

  it("10. detecta solapamientos con ausencias activas", () => {
    expect(findOverlaps(abs({ startDate: "2026-11-06", endDate: "2026-11-10" }), existing)).toHaveLength(1);
    expect(findOverlaps(abs({ startDate: "2026-11-09", endDate: "2026-11-10" }), existing)).toHaveLength(0);
  });

  it("ignora las rechazadas y permite mañana + tarde", () => {
    expect(findOverlaps(abs({ startDate: "2026-12-01", endDate: "2026-12-01" }), existing)).toHaveLength(0);
    expect(findOverlaps(abs({ startDate: "2026-11-20", endDate: "2026-11-20", portion: "AFTERNOON" }), existing)).toHaveLength(0);
    expect(findOverlaps(abs({ startDate: "2026-11-20", endDate: "2026-11-20", portion: "MORNING" }), existing)).toHaveLength(1);
  });

  it("9. detecta duplicados exactos", () => {
    expect(findDuplicate(abs({ startDate: "2026-11-02", endDate: "2026-11-06" }), existing)).toBeDefined();
    expect(findDuplicate(abs({ startDate: "2026-11-02", endDate: "2026-11-06", type: "COMPENSATORY" }), existing)).toBeUndefined();
  });

  it("no compara una ausencia consigo misma al editarla", () => {
    expect(findOverlaps(existing[0], existing)).toHaveLength(0);
  });
});
