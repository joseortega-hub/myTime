/**
 * Optimizador de vacaciones.
 *
 * 1. Genera TODOS los bloques candidatos: cada tramo contiguo de días dentro
 *    del rango en el que los días laborables se cogen como vacaciones y el
 *    resto ya son libres (fin de semana, festivo o ausencia ya registrada).
 *    El descanso de cada bloque se amplía con los días libres adyacentes.
 * 2. Para cada objetivo, elige la combinación de bloques no solapados que
 *    maximiza la puntuación con el presupuesto de días mediante programación
 *    dinámica exacta (planificación de intervalos ponderados con mochila).
 *
 * El resultado es óptimo respecto a la función de puntuación de cada objetivo
 * dentro del conjunto de bloques de días completos. Ver docs/ALGORITHM.md.
 */
import type { CalendarIndex, HolidayInfo } from "./calendar";
import { addDays, diffDays, eachDay, formatDate, maxIso, minIso, type IsoDate } from "./dates";

export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

export interface ReservedPeriod extends DateRange {
  label: string;
  /** Días de vacaciones que quieres guardar para ese periodo. */
  days: number;
}

export type OptimizerObjective = "BALANCED" | "MAX_REST" | "LONGEST" | "TEAM" | "VARIANT";

export const OBJECTIVE_LABEL: Record<OptimizerObjective, string> = {
  BALANCED: "Recomendada según tus preferencias",
  MAX_REST: "Máximo descanso por día gastado",
  LONGEST: "El descanso seguido más largo",
  TEAM: "Menos coincidencias con el equipo",
  VARIANT: "Alternativa con otras fechas",
};

export interface TeamAvailability {
  /** Tamaño del equipo sin contarte a ti. */
  size: number;
  absentByDate: Map<IsoDate, number>;
  /** Mínimo de compañeros presentes deseado (null = sin regla). */
  minPresent: number | null;
}

export interface OptimizerInput {
  range: DateRange;
  daysToSpend: number;
  /** Saldo disponible conocido, o null si no está configurado. */
  availableDays: number | null;
  calendar: CalendarIndex;
  /** Días con una ausencia propia ya registrada: cuentan como descanso gratuito. */
  occupiedDates: ReadonlySet<IsoDate>;
  excluded: DateRange[];
  priority: DateRange[];
  reserved: ReservedPeriod[];
  preferLongBreaks: boolean;
  avoidTeamOverlap: boolean;
  team?: TeamAvailability | null;
}

export interface Block {
  vacationDates: IsoDate[];
  cost: number;
  restStart: IsoDate;
  restEnd: IsoDate;
  restDays: number;
  holidays: HolidayInfo[];
  nonWorkingDays: number;
  occupiedDays: number;
  priorityDays: number;
  teamPersonDays: number;
  teamMaxAbsent: number;
  breaksCoverage: boolean;
  efficiency: number;
}

export interface PlanAlternative {
  id: string;
  objective: OptimizerObjective;
  /** Todos los objetivos para los que esta combinación es la mejor. */
  objectives: OptimizerObjective[];
  label: string;
  blocks: Block[];
  totalCost: number;
  totalRest: number;
  longestRest: number;
  efficiency: number;
  holidays: HolidayInfo[];
  nonWorkingDays: number;
  teamPersonDays: number;
  teamMaxAbsent: number;
  score: number;
  reasons: string[];
}

export interface OptimizerResult {
  budget: number;
  alternatives: PlanAlternative[];
  bridges: Block[];
  stats: { candidates: number; exhaustive: boolean; budget: number };
  warnings: string[];
}

const MAX_BUDGET = 60;

function inRanges(date: IsoDate, ranges: DateRange[]): boolean {
  return ranges.some((r) => date >= r.start && date <= r.end);
}

/** Puntuación común (refleja las preferencias del usuario). */
function balancedValue(b: Block, input: OptimizerInput): number {
  const longWeight = input.preferLongBreaks ? 0.05 : 0.01;
  const teamWeight = input.avoidTeamOverlap ? 0.6 : 0.1;
  return b.restDays + longWeight * b.restDays * b.restDays + 1.5 * b.priorityDays - teamWeight * b.teamPersonDays;
}

export function optimizeVacations(input: OptimizerInput): OptimizerResult {
  const warnings: string[] = [];
  const { calendar, occupiedDates } = input;

  const reservedDays = input.reserved.reduce((s, r) => s + Math.max(0, r.days), 0);
  let budget = Math.floor(input.daysToSpend);
  if (input.availableDays != null && budget > input.availableDays) {
    warnings.push(
      `Quieres gastar ${budget} días pero solo tienes ${input.availableDays} disponibles; se usa el saldo disponible.`,
    );
    budget = Math.floor(input.availableDays);
  }
  if (input.availableDays == null) {
    warnings.push("No hay saldo configurado: no se puede comprobar que tengas esos días disponibles.");
  }
  if (reservedDays > 0) budget -= reservedDays;
  if (budget > MAX_BUDGET) {
    warnings.push(`El optimizador limita el cálculo a ${MAX_BUDGET} días por ejecución.`);
    budget = MAX_BUDGET;
  }
  if (input.range.start > input.range.end) {
    return { budget: 0, alternatives: [], bridges: [], stats: { candidates: 0, exhaustive: true, budget: 0 }, warnings: ["El rango de fechas no es válido."] };
  }
  if (budget <= 0) {
    warnings.push("No quedan días para repartir después de las reservas.");
    return { budget: 0, alternatives: [], bridges: [], stats: { candidates: 0, exhaustive: true, budget: 0 }, warnings };
  }

  // Ventana ampliada para extender el descanso más allá del rango.
  const winStart = addDays(input.range.start, -60);
  const winEnd = addDays(input.range.end, 60);
  const days = eachDay(winStart, winEnd);
  const n = days.length;
  const free: boolean[] = new Array(n);
  const spendable: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = days[i];
    const working = calendar.isWorkingDay(d);
    const occupied = occupiedDates.has(d);
    free[i] = !working || occupied;
    spendable[i] =
      working &&
      !occupied &&
      d >= input.range.start &&
      d <= input.range.end &&
      !inRanges(d, input.excluded) &&
      !inRanges(d, input.reserved);
  }
  const team = input.team && input.team.size > 0 ? input.team : null;

  // ── 1. Generación exhaustiva de bloques ──
  const candidates: Block[] = [];
  const firstIdx = diffDays(winStart, input.range.start);
  const lastIdx = diffDays(winStart, input.range.end);
  for (let i = firstIdx; i <= lastIdx; i++) {
    if (!spendable[i]) continue;
    let cost = 0;
    for (let j = i; j <= lastIdx; j++) {
      if (spendable[j]) {
        cost++;
        if (cost > budget) break;
        candidates.push(buildBlock(i, j, cost));
      } else if (!free[j]) {
        break; // día laborable que no se puede coger: corta el bloque
      }
    }
  }

  function buildBlock(i: number, j: number, cost: number): Block {
    let s = i;
    while (s - 1 >= 0 && free[s - 1]) s--;
    let e = j;
    while (e + 1 < n && free[e + 1]) e++;
    const vacationDates: IsoDate[] = [];
    let nonWorking = 0;
    let occupied = 0;
    let priority = 0;
    let teamPersonDays = 0;
    let teamMax = 0;
    let breaksCoverage = false;
    const holidays: HolidayInfo[] = [];
    for (let k = s; k <= e; k++) {
      const d = days[k];
      const h = calendar.holidayOn(d);
      if (h) holidays.push(h);
      if (k >= i && k <= j && spendable[k]) {
        vacationDates.push(d);
        if (inRanges(d, input.priority)) priority++;
        if (team) {
          const absent = team.absentByDate.get(d) ?? 0;
          teamPersonDays += absent;
          teamMax = Math.max(teamMax, absent);
          if (team.minPresent != null && team.size - absent < team.minPresent) breaksCoverage = true;
        }
      } else if (occupiedDates.has(d) && calendar.isWorkingDay(d)) {
        occupied++;
      } else if (!calendar.isWorkingDay(d) && !h) {
        nonWorking++;
      }
    }
    const restDays = e - s + 1;
    return {
      vacationDates, cost, restStart: days[s], restEnd: days[e], restDays,
      holidays, nonWorkingDays: nonWorking, occupiedDays: occupied, priorityDays: priority,
      teamPersonDays, teamMaxAbsent: teamMax, breaksCoverage, efficiency: restDays / cost,
    };
  }

  // Orden por fin de descanso para la programación dinámica.
  candidates.sort((a, b) => (a.restEnd < b.restEnd ? -1 : a.restEnd > b.restEnd ? 1 : a.cost - b.cost));

  const alternatives: PlanAlternative[] = [];
  const seen = new Map<string, PlanAlternative>();
  const push = (objective: OptimizerObjective, blocks: Block[]) => {
    if (blocks.length === 0) return;
    const sig = blocks.flatMap((b) => b.vacationDates).sort().join(",");
    const existing = seen.get(sig);
    // La misma combinación cumple varios objetivos: se muestra una sola vez.
    if (existing) {
      if (!existing.objectives.includes(objective)) existing.objectives.push(objective);
      return;
    }
    const plan = makePlan(objective, blocks, input);
    seen.set(sig, plan);
    alternatives.push(plan);
  };

  const teamAware = (b: Block) => !(input.avoidTeamOverlap && b.breaksCoverage);

  // Recomendada (preferencias del usuario)
  const balanced = selectBlocks(candidates, budget, (b) => (teamAware(b) ? balancedValue(b, input) : -1));
  push("BALANCED", balanced);

  // B. Máximo descanso total con el presupuesto
  push("MAX_REST", selectBlocks(candidates, budget, (b) => (teamAware(b) ? b.restDays - b.cost * 1e-3 : -1)));

  // A. El descanso seguido más largo + resto del presupuesto
  const longest = candidates
    .filter(teamAware)
    .reduce<Block | null>((best, b) => {
      if (!best) return b;
      if (b.restDays !== best.restDays) return b.restDays > best.restDays ? b : best;
      return b.cost < best.cost ? b : best;
    }, null);
  if (longest) {
    const rest = candidates.filter((c) => !restOverlaps(c, longest));
    const filler = selectBlocks(rest, budget - longest.cost, (b) => (teamAware(b) ? b.restDays : -1));
    push("LONGEST", sortBlocks([longest, ...filler]));
  }

  // C. Evitar coincidencias con el equipo
  if (team) {
    push(
      "TEAM",
      selectBlocks(candidates, budget, (b) => (b.breaksCoverage ? -1 : b.restDays - 3 * b.teamPersonDays)),
    );
  } else if (input.avoidTeamOverlap) {
    warnings.push("No hay datos de ausencias del equipo: no se pueden evitar coincidencias.");
  }

  // Variante: misma puntuación evitando el bloque principal de la recomendada
  if (balanced.length > 0) {
    const main = balanced.reduce((a, b) => (b.restDays > a.restDays ? b : a));
    const pool = candidates.filter((c) => !restOverlaps(c, main));
    push("VARIANT", selectBlocks(pool, budget, (b) => (teamAware(b) ? balancedValue(b, input) : -1)));
  }

  alternatives.sort((a, b) => b.score - a.score);

  // Mejores puentes individuales (pocas jornadas, mucho descanso), sin redundancias
  const bridges: Block[] = [];
  const bridgePool = candidates
    .filter((c) => c.cost <= Math.min(budget, 5) && c.efficiency > 1.5 && teamAware(c))
    .sort((a, b) => b.efficiency - a.efficiency || b.restDays - a.restDays || a.cost - b.cost);
  for (const c of bridgePool) {
    if (bridges.length >= 8) break;
    if (bridges.some((b) => restOverlaps(b, c))) continue;
    bridges.push(c);
  }
  bridges.sort((a, b) => (a.restStart < b.restStart ? -1 : 1));

  return {
    budget,
    alternatives,
    bridges,
    stats: { candidates: candidates.length, exhaustive: true, budget },
    warnings,
  };
}

function restOverlaps(a: Block, b: Block): boolean {
  // Se exige al menos un día laborable entre descansos para no contarlos dos veces.
  return a.restStart <= addDays(b.restEnd, 1) && b.restStart <= addDays(a.restEnd, 1);
}

function sortBlocks(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => (a.restStart < b.restStart ? -1 : 1));
}

/**
 * Selección óptima de bloques no solapados con coste total ≤ presupuesto que
 * maximiza la suma de `value`. Bloques con valor ≤ 0 se descartan.
 * Requiere `candidates` ordenados por `restEnd`.
 */
export function selectBlocks(candidates: Block[], budget: number, value: (b: Block) => number): Block[] {
  if (budget <= 0) return [];
  const pool = candidates.map((b) => ({ b, v: value(b) })).filter((x) => x.v > 0 && x.b.cost <= budget);
  pool.sort((x, y) => (x.b.restEnd < y.b.restEnd ? -1 : x.b.restEnd > y.b.restEnd ? 1 : 0));
  const m = pool.length;
  if (m === 0) return [];

  // prev[k] = nº de bloques (prefijo) compatibles con el bloque k.
  const ends = pool.map((x) => x.b.restEnd);
  const prev = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    const limit = addDays(pool[k].b.restStart, -1); // fin anterior debe ser < restStart - 1
    let lo = 0;
    let hi = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] < limit) lo = mid + 1;
      else hi = mid;
    }
    prev[k] = lo;
  }

  const W = budget + 1;
  const dp = new Float64Array((m + 1) * W);
  const take = new Uint8Array((m + 1) * W);
  for (let k = 1; k <= m; k++) {
    const { b, v } = pool[k - 1];
    const p = prev[k - 1];
    for (let c = 0; c < W; c++) {
      const skip = dp[(k - 1) * W + c];
      let best = skip;
      if (c >= b.cost) {
        const withIt = dp[p * W + (c - b.cost)] + v;
        if (withIt > skip + 1e-9) {
          best = withIt;
          take[k * W + c] = 1;
        }
      }
      dp[k * W + c] = best;
    }
  }

  const chosen: Block[] = [];
  let k = m;
  let c = budget;
  while (k > 0 && c >= 0) {
    if (take[k * W + c]) {
      const { b } = pool[k - 1];
      chosen.push(b);
      c -= b.cost;
      k = prev[k - 1];
    } else {
      k--;
    }
  }
  return sortBlocks(chosen);
}

function makePlan(objective: OptimizerObjective, blocks: Block[], input: OptimizerInput): PlanAlternative {
  const totalCost = blocks.reduce((s, b) => s + b.cost, 0);
  const totalRest = blocks.reduce((s, b) => s + b.restDays, 0);
  const longestRest = blocks.reduce((s, b) => Math.max(s, b.restDays), 0);
  const holidays = blocks.flatMap((b) => b.holidays);
  const teamPersonDays = blocks.reduce((s, b) => s + b.teamPersonDays, 0);
  const teamMaxAbsent = blocks.reduce((s, b) => Math.max(s, b.teamMaxAbsent), 0);
  const score = Math.round(blocks.reduce((s, b) => s + balancedValue(b, input), 0) * 10) / 10;
  const efficiency = totalCost > 0 ? totalRest / totalCost : 0;

  const reasons: string[] = [];
  reasons.push(
    `Con ${totalCost} ${totalCost === 1 ? "día" : "días"} de vacaciones sumas ${totalRest} días de descanso (${efficiency.toFixed(2)} días libres por día gastado).`,
  );
  if (blocks.length > 1) reasons.push(`Reparte el descanso en ${blocks.length} periodos; el más largo dura ${longestRest} días.`);
  else reasons.push(`Un único descanso de ${longestRest} días seguidos.`);
  if (holidays.length > 0) {
    const names = holidays.slice(0, 3).map((h) => `${h.name} (${formatDate(h.date, "short")})`);
    reasons.push(`Aprovecha ${holidays.length === 1 ? "el festivo" : "los festivos"} ${names.join(", ")}${holidays.length > 3 ? "…" : ""}.`);
  }
  const occupied = blocks.reduce((s, b) => s + b.occupiedDays, 0);
  if (occupied > 0) reasons.push("Amplía ausencias que ya tienes registradas.");
  const priority = blocks.reduce((s, b) => s + b.priorityDays, 0);
  if (priority > 0) reasons.push(`Incluye ${priority} ${priority === 1 ? "día" : "días"} de tus fechas prioritarias.`);
  if (input.team && input.team.size > 0) {
    reasons.push(
      teamMaxAbsent === 0
        ? "Ningún compañero tiene ausencias registradas en esas fechas."
        : `Coincide con un máximo de ${teamMaxAbsent} ${teamMaxAbsent === 1 ? "compañero ausente" : "compañeros ausentes"} el mismo día.`,
    );
  }

  const first = blocks[0];
  return {
    id: `${objective}-${first.restStart}-${totalCost}`,
    objective,
    objectives: [objective],
    label: OBJECTIVE_LABEL[objective],
    blocks,
    totalCost,
    totalRest,
    longestRest,
    efficiency,
    holidays,
    nonWorkingDays: blocks.reduce((s, b) => s + b.nonWorkingDays, 0),
    teamPersonDays,
    teamMaxAbsent,
    score,
    reasons,
  };
}

/** Agrupa fechas sueltas en rangos contiguos (para guardar como ausencias). */
export function groupContiguous(dates: IsoDate[]): DateRange[] {
  const sorted = [...new Set(dates)].sort();
  const out: DateRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === d) last.end = d;
    else out.push({ start: d, end: d });
  }
  return out;
}

export function clampRange(range: DateRange, outer: DateRange): DateRange {
  return { start: maxIso(range.start, outer.start), end: minIso(range.end, outer.end) };
}
