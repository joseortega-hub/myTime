import type { Metadata } from "next";
import { CalendarView, type CalendarAbsence } from "@/components/calendar-view";
import { PageHeader } from "@/components/ui";
import { calendarCompleteness } from "@/domain/calendar";
import { endOfYear, startOfYear, yearOf, monthOf } from "@/domain/dates";
import { absentCountByDate } from "@/domain/team";
import { getCalendarContext, today } from "@/server/context";
import { listAbsences } from "@/server/services/absences";
import { listTeamAbsences, listTeams } from "@/server/services/team";
import { listOnCall } from "@/server/services/oncall";

export const metadata: Metadata = { title: "Calendario" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const yearParam = Number(sp["año"]);
  const monthParam = Number(sp.mes);
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : yearOf(now);
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : monthOf(now);
  const view = sp.vista === "año" ? "year" : "month";

  const { rules } = await getCalendarContext();
  const [absences, teamAbs, teams, onCall] = await Promise.all([
    listAbsences({ year }),
    listTeamAbsences(startOfYear(year), endOfYear(year)),
    listTeams(),
    listOnCall(year),
  ]);
  const teamCounts = Object.fromEntries(absentCountByDate(teamAbs, startOfYear(year), endOfYear(year)));
  const items: CalendarAbsence[] = absences.map((a) => ({
    id: a.id, type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate,
    portion: a.portion, daysOverride: a.daysOverride, notes: a.notes, origin: a.origin,
  }));

  return (
    <>
      <PageHeader title="Calendario laboral" description="Festivos, fines de semana, tus ausencias y las del equipo en una sola vista." />
      <CalendarView
        year={year}
        month={month}
        view={view}
        today={now}
        rules={rules}
        absences={items}
        onCall={onCall.filter((g) => g.status !== "CANCELLED").map((g) => ({ id: g.id, startDate: g.startDate, endDate: g.endDate, kind: g.kind }))}
        teamCounts={teamCounts}
        teamSize={teams.reduce((s, t) => s + t.members.length, 0)}
        hasDemoTeam={teams.some((t) => t.isDemo)}
        complete={calendarCompleteness(rules, year).complete}
      />
    </>
  );
}
