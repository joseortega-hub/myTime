import type { Metadata } from "next";
import { VacationMap, type MapAbsence } from "@/components/vacation-map";
import { PageHeader } from "@/components/ui";
import { addMonths, closingWindow } from "@/domain/deadlines";
import { endOfMonth, monthOf, startOfMonth, yearOf } from "@/domain/dates";
import { absentCountByDate } from "@/domain/team";
import { getCalendarContext, today } from "@/server/context";
import { getBalances } from "@/server/services/absences";
import { getAlertRules } from "@/server/services/planning";
import { listTeamAbsences } from "@/server/services/team";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mapa de vacaciones" };
export const dynamic = "force-dynamic";

const MONTHS = 15;

export default async function VacationMapPage() {
  const now = today();
  const start = startOfMonth(yearOf(now), monthOf(now));
  const lastMonth = addMonths(start, MONTHS - 1);
  const end = endOfMonth(yearOf(lastMonth), monthOf(lastMonth));
  const { user, rules } = await getCalendarContext();
  const [alertRules, absences, teamAbs, balances] = await Promise.all([
    getAlertRules(),
    db.absence.findMany({ where: { userId: user.id, startDate: { lte: end }, endDate: { gte: start }, status: { notIn: ["CANCELLED"] } } }),
    listTeamAbsences(start, end),
    getBalances(yearOf(now)),
  ]);
  const lead = alertRules.vacationLeadMonths;
  const vac = balances.find((b) => b.type === "VACATION")!;
  const items: MapAbsence[] = absences.map((a) => ({ id: a.id, type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate, portion: a.portion }));

  return (
    <>
      <PageHeader
        title="Mapa de vacaciones"
        description={`Los próximos ${MONTHS} meses de un vistazo. Las vacaciones se piden con ${lead} ${lead === 1 ? "mes" : "meses"} de antelación: verás qué días siguen en plazo y cuáles se cierran pronto.`}
      />
      <VacationMap
        today={now}
        start={start}
        months={MONTHS}
        leadMonths={lead}
        rules={rules}
        absences={items}
        teamCounts={Object.fromEntries(absentCountByDate(teamAbs, start, end))}
        closing={closingWindow(now, lead)}
        freeDays={vac.available == null ? null : Math.max(0, vac.available - vac.requested - vac.planned)}
      />
    </>
  );
}
