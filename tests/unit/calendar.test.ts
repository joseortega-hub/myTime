import { describe, expect, it } from "vitest";
import { calendarCompleteness, CalendarIndex, countWorkingDays, summarizePeriod, type WorkCalendarRules } from "@/domain/calendar";
import { addDays, eachDay, isIsoDate, isoWeekday, monthGrid, spanDays, todayIso } from "@/domain/dates";

const MON_FRI: WorkCalendarRules = { workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };

describe("fechas", () => {
  it("valida fechas ISO reales", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-01-01")).toBe(false);
  });

  it("no se desplaza con el cambio de hora de verano", () => {
    // Último domingo de marzo y de octubre (cambio de hora en Europa)
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(eachDay("2026-03-27", "2026-03-31")).toHaveLength(5);
  });

  it("calcula el día de la semana ISO", () => {
    expect(isoWeekday("2026-10-26")).toBe(1); // lunes
    expect(isoWeekday("2026-11-01")).toBe(7); // domingo
  });

  it("calcula hoy en la zona horaria indicada", () => {
    const lateUtc = new Date("2026-12-31T23:30:00Z");
    expect(todayIso("Europe/Madrid", lateUtc)).toBe("2027-01-01");
    expect(todayIso("UTC", lateUtc)).toBe("2026-12-31");
  });

  it("genera cuadrículas de mes que empiezan en lunes", () => {
    const grid = monthGrid(2026, 2);
    expect(grid[0][0].date).toBe("2026-01-26");
    expect(grid.flat().filter((d) => !d.outside)).toHaveLength(28);
  });
});

describe("días laborables", () => {
  it("1. cuenta días laborables entre dos fechas", () => {
    expect(countWorkingDays("2026-10-26", "2026-10-30", MON_FRI)).toBe(5);
    expect(countWorkingDays("2026-10-30", "2026-10-30", MON_FRI)).toBe(1);
  });

  it("2. excluye fines de semana", () => {
    expect(countWorkingDays("2026-10-24", "2026-10-25", MON_FRI)).toBe(0);
    expect(countWorkingDays("2026-10-19", "2026-11-01", MON_FRI)).toBe(10);
  });

  it("3. excluye festivos configurados", () => {
    const cal: WorkCalendarRules = {
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: [{ date: "2026-10-12", name: "Fiesta Nacional", scope: "NATIONAL" }],
    };
    expect(countWorkingDays("2026-10-12", "2026-10-16", cal)).toBe(4);
    // Un festivo en sábado no resta nada
    const sat: WorkCalendarRules = { ...MON_FRI, holidays: [{ date: "2026-10-24", name: "X", scope: "LOCAL" }] };
    expect(countWorkingDays("2026-10-19", "2026-10-25", sat)).toBe(5);
  });

  it("4. respeta calendarios con distintos días laborables", () => {
    const tueSat: WorkCalendarRules = { workingWeekdays: [2, 3, 4, 5, 6], holidays: [] };
    expect(countWorkingDays("2026-10-26", "2026-11-01", tueSat)).toBe(5);
    const idx = new CalendarIndex(tueSat);
    expect(idx.isWorkingDay("2026-10-26")).toBe(false); // lunes
    expect(idx.isWorkingDay("2026-10-31")).toBe(true); // sábado
    const fourDays: WorkCalendarRules = { workingWeekdays: [1, 2, 3, 4], holidays: [] };
    expect(countWorkingDays("2026-10-26", "2026-11-01", fourDays)).toBe(4);
  });

  it("resume un periodo", () => {
    const cal: WorkCalendarRules = {
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: [{ date: "2026-12-08", name: "Inmaculada", scope: "NATIONAL" }],
    };
    const s = summarizePeriod("2026-12-07", "2026-12-13", cal);
    expect(s).toMatchObject({ naturalDays: 7, workingDays: 4, nonWorkingDays: 2, holidaysOnWorkingDays: 1 });
    expect(spanDays("2026-12-07", "2026-12-13")).toBe(7);
  });

  it("marca el calendario como incompleto si no está confirmado", () => {
    const r = calendarCompleteness({ workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }, 2026);
    expect(r.complete).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
    const ok = calendarCompleteness(
      { workingWeekdays: [1, 2, 3, 4, 5], holidays: [{ date: "2026-01-01", name: "Año Nuevo", scope: "NATIONAL" }], verifiedYears: [2026] },
      2026,
    );
    expect(ok.complete).toBe(true);
  });
});
