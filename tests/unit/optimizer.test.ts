import { describe, expect, it } from "vitest";
import { CalendarIndex } from "@/domain/calendar";
import { optimizeVacations, type OptimizerInput } from "@/domain/optimizer";

const holidays = [
  { date: "2026-12-07", name: "Puente", scope: "COMPANY" as const },
  { date: "2026-12-08", name: "Inmaculada", scope: "NATIONAL" as const },
  { date: "2026-12-25", name: "Navidad", scope: "NATIONAL" as const },
  { date: "2026-11-02", name: "Festivo lunes", scope: "LOCAL" as const },
];
const calendar = new CalendarIndex({ workingWeekdays: [1, 2, 3, 4, 5], holidays });

function input(p: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    range: { start: "2026-11-01", end: "2026-12-31" },
    daysToSpend: 5,
    availableDays: 20,
    calendar,
    occupiedDates: new Set(),
    excluded: [],
    priority: [],
    reserved: [],
    preferLongBreaks: false,
    avoidTeamOverlap: false,
    team: null,
    ...p,
  };
}

describe("optimizador", () => {
  it("12. encuentra el puente más rentable con un día", () => {
    const r = optimizeVacations(input({ daysToSpend: 1, range: { start: "2026-12-01", end: "2026-12-31" } }));
    const best = r.alternatives.find((a) => a.objectives.includes("MAX_REST"))!;
    // Hay dos opciones de 4 días con 1 día: 4-7 dic no (7 y 8 ya festivos → 5-8 sin gastar), 24-27 dic sí.
    expect(best.totalCost).toBe(1);
    expect(best.totalRest).toBeGreaterThanOrEqual(4);
    expect(r.stats.exhaustive).toBe(true);
  });

  it("12. con 5 días maximiza el descanso total y nunca supera el presupuesto", () => {
    const r = optimizeVacations(input());
    expect(r.alternatives.length).toBeGreaterThan(0);
    for (const a of r.alternatives) {
      expect(a.totalCost).toBeLessThanOrEqual(5);
      // Los bloques no se solapan
      for (let i = 1; i < a.blocks.length; i++) expect(a.blocks[i].restStart > a.blocks[i - 1].restEnd).toBe(true);
    }
    const maxRest = r.alternatives.find((a) => a.objectives.includes("MAX_REST"))!;
    // Fuerza bruta de referencia: descansos individuales con 5 días en el rango
    expect(maxRest.totalRest).toBeGreaterThanOrEqual(12);
  });

  it("aprovecha festivos y explica el motivo", () => {
    const r = optimizeVacations(input({ daysToSpend: 1, range: { start: "2026-12-01", end: "2026-12-31" } }));
    const withHoliday = r.alternatives.find((a) => a.holidays.length > 0);
    expect(withHoliday).toBeDefined();
    expect(withHoliday!.reasons.join(" ")).toMatch(/festivo/);
  });

  it("13. respeta las fechas excluidas", () => {
    const r = optimizeVacations(input({ excluded: [{ start: "2026-12-21", end: "2026-12-31" }] }));
    for (const a of r.alternatives) for (const b of a.blocks) for (const d of b.vacationDates) expect(d < "2026-12-21").toBe(true);
  });

  it("13. respeta el rango elegido", () => {
    const r = optimizeVacations(input({ range: { start: "2026-11-09", end: "2026-11-20" } }));
    for (const a of r.alternatives)
      for (const b of a.blocks) for (const d of b.vacationDates) expect(d >= "2026-11-09" && d <= "2026-11-20").toBe(true);
  });

  it("13. descuenta las reservas del presupuesto y no usa esos días", () => {
    const r = optimizeVacations(
      input({ daysToSpend: 8, reserved: [{ start: "2026-12-21", end: "2026-12-31", label: "Navidad", days: 5 }] }),
    );
    expect(r.budget).toBe(3);
    for (const a of r.alternatives) for (const b of a.blocks) for (const d of b.vacationDates) expect(d < "2026-12-21").toBe(true);
  });

  it("13. limita el gasto al saldo disponible", () => {
    const r = optimizeVacations(input({ daysToSpend: 10, availableDays: 3 }));
    expect(r.budget).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/solo tienes 3/);
  });

  it("13. no gasta días ya ocupados por ausencias registradas", () => {
    const occupied = new Set(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    const r = optimizeVacations(input({ occupiedDates: occupied }));
    for (const a of r.alternatives) for (const b of a.blocks) for (const d of b.vacationDates) expect(occupied.has(d)).toBe(false);
  });

  it("14. evita los días con poca cobertura del equipo", () => {
    const absentByDate = new Map<string, number>();
    for (const d of ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"])
      absentByDate.set(d, 3);
    const r = optimizeVacations(
      input({ avoidTeamOverlap: true, team: { size: 4, absentByDate, minPresent: 2 } }),
    );
    const teamPlan = r.alternatives.find((a) => a.objectives.includes("TEAM"))!;
    expect(teamPlan).toBeDefined();
    expect(teamPlan.teamMaxAbsent).toBe(0);
    for (const a of r.alternatives) for (const b of a.blocks) expect(b.breaksCoverage).toBe(false);
  });

  it("prioriza las fechas indicadas", () => {
    const r = optimizeVacations(input({ daysToSpend: 2, priority: [{ start: "2026-11-23", end: "2026-11-24" }] }));
    expect(r.alternatives[0].blocks.flatMap((b) => b.vacationDates)).toEqual(expect.arrayContaining(["2026-11-23"]));
  });

  it("no devuelve alternativas duplicadas", () => {
    const r = optimizeVacations(input());
    const sigs = r.alternatives.map((a) => a.blocks.flatMap((b) => b.vacationDates).join());
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(r.bridges.length).toBeLessThanOrEqual(8);
  });

  it("devuelve un aviso si no queda presupuesto", () => {
    const r = optimizeVacations(input({ daysToSpend: 0 }));
    expect(r.alternatives).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("es óptimo frente a una búsqueda por fuerza bruta (presupuesto 2)", () => {
    const small = input({ daysToSpend: 2, range: { start: "2026-11-30", end: "2026-12-31" } });
    const r = optimizeVacations(small);
    const best = r.alternatives.find((a) => a.objectives.includes("MAX_REST"))!;
    // Fuerza bruta: todas las parejas de días laborables
    const working = calendar.workingDaysIn("2026-11-30", "2026-12-31");
    let bruteBest = 0;
    for (let i = 0; i < working.length; i++)
      for (let j = i; j < working.length; j++) {
        const occ = new Set([working[i], working[j]]);
        // Descanso total = suma de rachas libres que contienen algún día elegido
        const free = (d: string) => !calendar.isWorkingDay(d) || occ.has(d);
        const seen = new Set<string>();
        let total = 0;
        for (const d of occ) {
          if (seen.has(d)) continue;
          let s = d;
          let e = d;
          const prev = (x: string) => new Date(Date.parse(x) - 864e5).toISOString().slice(0, 10);
          const next = (x: string) => new Date(Date.parse(x) + 864e5).toISOString().slice(0, 10);
          while (free(prev(s))) s = prev(s);
          while (free(next(e))) e = next(e);
          for (let x = s; x <= e; x = next(x)) seen.add(x);
          total += (Date.parse(e) - Date.parse(s)) / 864e5 + 1;
        }
        bruteBest = Math.max(bruteBest, total);
      }
    expect(best.totalRest).toBe(bruteBest);
  });
});
