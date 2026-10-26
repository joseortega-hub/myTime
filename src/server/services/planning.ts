import "server-only";
import { ACTIVE_STATUSES } from "@/domain/absences";
import { generateAlerts, DEFAULT_ALERT_RULES, type AlertRules, type AppAlert } from "@/domain/alerts";
import { calendarCompleteness } from "@/domain/calendar";
import { addDays, eachDay, endOfYear, isoWeekday, maxIso, minIso, startOfWeek, startOfYear, yearOf } from "@/domain/dates";
import { optimizeVacations, type OptimizerResult } from "@/domain/optimizer";
import { absentCountByDate, availabilitySeries, coverageAlerts } from "@/domain/team";
import { UserFacingError } from "@/lib/result";
import { alertRulesSchema, optimizerRequestSchema, savePlanSchema } from "@/lib/validation";
import { getCalendarContext, getCurrentUser, today } from "../context";
import { db } from "../db";
import { getBalances } from "./absences";
import { daysMissingHours, getWeek } from "./hours";
import { getJiraStatus } from "./integrations";
import { listTeamAbsences, listTeams } from "./team";

export async function runOptimizer(raw: unknown): Promise<OptimizerResult & { availableDays: number | null }> {
  const req = optimizerRequestSchema.parse(raw);
  const { user, index } = await getCalendarContext();
  const range = { start: maxIso(req.range.start, startOfYear(req.year)), end: minIso(req.range.end, endOfYear(req.year)) };
  if (range.start > range.end) throw new UserFacingError("El rango debe estar dentro del año seleccionado.");

  const balances = await getBalances(req.year);
  const vacation = balances.find((b) => b.type === "VACATION")!;
  // Para el optimizador, lo disponible descuenta también lo ya solicitado o planificado.
  const availableDays = vacation.available == null ? null : Math.max(0, vacation.available - vacation.requested - vacation.planned);

  const absences = await db.absence.findMany({
    where: { userId: user.id, startDate: { lte: addDays(range.end, 60) }, endDate: { gte: addDays(range.start, -60) } },
  });
  const occupied = new Set<string>();
  for (const a of absences) {
    if (!ACTIVE_STATUSES.has(a.status) || a.portion !== "FULL") continue;
    for (const d of eachDay(a.startDate, a.endDate)) occupied.add(d);
  }

  let team = null;
  if (req.teamId) {
    const t = (await listTeams()).find((x) => x.id === req.teamId);
    if (t && t.members.length > 0) {
      const ids = new Set(t.members.map((m) => m.id));
      const teamAbs = (await listTeamAbsences(range.start, range.end)).filter((a) => ids.has(a.personId));
      team = { size: t.members.length, absentByDate: absentCountByDate(teamAbs, range.start, range.end), minPresent: t.minPresent };
    }
  }

  const result = optimizeVacations({
    range,
    daysToSpend: req.daysToSpend,
    availableDays,
    calendar: index,
    occupiedDates: occupied,
    excluded: req.excluded,
    priority: req.priority,
    reserved: req.reserved,
    preferLongBreaks: req.preferLongBreaks,
    avoidTeamOverlap: req.avoidTeamOverlap,
    team,
  });
  return { ...result, availableDays };
}

/** Guarda una propuesta como planificación personal (ausencias PLANIFICADAS). */
export async function savePlan(raw: unknown) {
  const input = savePlanSchema.parse(raw);
  const user = await getCurrentUser();
  const all = input.blocks.flatMap((b) => b.vacationDates);
  const existing = await db.absence.findMany({
    where: { userId: user.id, startDate: { lte: all.reduce((a, b) => (a > b ? a : b)) }, endDate: { gte: all.reduce((a, b) => (a < b ? a : b)) } },
  });
  const clash = all.find((d) => existing.some((a) => ACTIVE_STATUSES.has(a.status) && a.startDate <= d && a.endDate >= d));
  if (clash) throw new UserFacingError(`El ${clash} ya tiene una ausencia registrada. Vuelve a calcular las propuestas.`);

  return db.$transaction(async (tx) => {
    const plan = await tx.plan.create({
      data: { userId: user.id, year: input.year, name: input.name, objective: input.objective, score: input.score, summary: input.blocks },
    });
    for (const b of input.blocks) {
      const sorted = [...b.vacationDates].sort();
      await tx.absence.create({
        data: {
          userId: user.id, type: "VACATION", status: "PLANNED",
          startDate: sorted[0], endDate: sorted[sorted.length - 1], portion: "FULL",
          origin: "optimizer", planId: plan.id,
          notes: `Propuesta del optimizador: ${b.restDays} días de descanso`,
          events: { create: { toStatus: "PLANNED", note: "Guardada desde el optimizador" } },
        },
      });
    }
    return plan;
  });
}

export async function listPlans() {
  const user = await getCurrentUser();
  return db.plan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { absences: true } });
}

/** Borra la planificación y sus ausencias que sigan solo planificadas. */
export async function deletePlan(id: string) {
  const user = await getCurrentUser();
  const plan = await db.plan.findFirst({ where: { id, userId: user.id } });
  if (!plan) throw new UserFacingError("La planificación ya no existe.");
  await db.$transaction([
    db.absence.deleteMany({ where: { planId: id, status: "PLANNED" } }),
    db.plan.delete({ where: { id } }),
  ]);
}

// ── Alertas ─────────────────────────────────────────────────

export async function getAlertRules(): Promise<AlertRules> {
  const user = await getCurrentUser();
  const prefs = (user.preferences ?? {}) as { alerts?: unknown };
  const parsed = alertRulesSchema.safeParse(prefs.alerts);
  return parsed.success ? parsed.data : DEFAULT_ALERT_RULES;
}

export async function saveAlertRules(raw: unknown) {
  const rules = alertRulesSchema.parse(raw);
  const user = await getCurrentUser();
  const prefs = (user.preferences ?? {}) as Record<string, unknown>;
  await db.userProfile.update({ where: { id: user.id }, data: { preferences: { ...prefs, alerts: rules } } });
}

/** Calcula todas las alertas para una fecha (por defecto, hoy). */
export async function computeAlerts(now: string = today()): Promise<AppAlert[]> {
  const year = yearOf(now);
  const { user, rules: calRules, index } = await getCalendarContext();
  const [rules, absences, balances, teams, missing, onCall, week] = await Promise.all([
    getAlertRules(),
    db.absence.findMany({ where: { userId: user.id, endDate: { gte: addDays(now, -30) } } }),
    getBalances(year),
    listTeams(),
    daysMissingHours(),
    db.onCallShift.findMany({ where: { userId: user.id, status: "PLANNED", endDate: { gte: now } } }),
    getWeek(startOfWeek(now)),
  ]);
  const workWeek = week.filter((d) => isoWeekday(d.date) <= 5);
  const jira = getJiraStatus();
  const horizonEnd = addDays(now, 90);
  const teamAbs = await listTeamAbsences(now, horizonEnd);
  const overlaps = teams.flatMap((t) =>
    t.members.length === 0
      ? []
      : coverageAlerts(
          availabilitySeries({
            members: t.members.map((m) => ({ ...m })),
            absences: teamAbs,
            start: now,
            end: horizonEnd,
            calendar: index,
            minPresent: t.minPresent,
          }),
        ),
  );
  return generateAlerts({
    today: now,
    rules,
    absences: absences.map((a) => ({ ...a, daysOverride: a.daysOverride })),
    holidays: calRules.holidays,
    vacationBalance: balances.find((b) => b.type === "VACATION") ?? null,
    teamOverlaps: overlaps,
    calendarComplete: calendarCompleteness(calRules, year).complete,
    daysMissingHours: missing,
    onCall: onCall.map((g) => ({ id: g.id, startDate: g.startDate, endDate: g.endDate, kind: g.kind, startTime: g.startTime })),
    week: {
      expectedMinutes: workWeek.reduce((n, d) => n + d.expected, 0),
      loggedMinutes: workWeek.reduce((n, d) => n + d.logged, 0),
      unsyncedEntries: workWeek.flatMap((d) => d.entries).filter((e) => e.syncStatus !== "SYNCED").length,
      jiraWriteEnabled: jira.writeEnabled,
    },
  });
}

export async function getAlerts(includeDismissed = false): Promise<(AppAlert & { dismissed: boolean })[]> {
  const [alerts, dismissed] = await Promise.all([computeAlerts(), db.alertDismissal.findMany()]);
  const dismissedKeys = new Set(dismissed.map((d) => d.key));
  return alerts
    .map((a) => ({ ...a, dismissed: dismissedKeys.has(a.key) }))
    .filter((a) => includeDismissed || !a.dismissed);
}

export async function dismissAlert(key: string, dismissed: boolean) {
  if (typeof key !== "string" || key.length > 2000) throw new UserFacingError("Alerta no válida.");
  if (dismissed) await db.alertDismissal.upsert({ where: { key }, update: {}, create: { key } });
  else await db.alertDismissal.deleteMany({ where: { key } });
}

