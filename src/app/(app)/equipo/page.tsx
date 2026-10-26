import type { Metadata } from "next";
import { TeamView } from "@/components/team-view";
import { PageHeader } from "@/components/ui";
import { addDays, diffDays, isIsoDate } from "@/domain/dates";
import { availabilitySeries, coverageAlerts, findLowConcentrationWindows } from "@/domain/team";
import { getCalendarContext, today } from "@/server/context";
import { listTeamAbsences, listTeams } from "@/server/services/team";

export const metadata: Metadata = { title: "Equipo" };
export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  let start = isIsoDate(sp.desde) ? sp.desde : now;
  let end = isIsoDate(sp.hasta) ? sp.hasta : addDays(start, 41);
  if (end < start) [start, end] = [end, start];
  if (diffDays(start, end) > 92) end = addDays(start, 92); // límite de la vista compartida
  const windowDays = Math.min(Math.max(Number(sp.ventana) || 5, 1), 20);

  const { index } = await getCalendarContext();
  const [teams, absences] = await Promise.all([listTeams(), listTeamAbsences(start, end)]);
  const team = teams.find((t) => t.id === sp.equipo) ?? teams[0] ?? null;
  const members = team?.members ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const teamAbsences = absences.filter((a) => memberIds.has(a.personId));
  const series = team
    ? availabilitySeries({ members, absences: teamAbsences, start, end, calendar: index, minPresent: team.minPresent })
    : [];

  return (
    <>
      <PageHeader
        title="Disponibilidad del equipo"
        description="Solo se muestra quién está ausente y cuándo; nunca motivos ni detalles personales."
      />
      <TeamView
        teams={teams.map((t) => ({ id: t.id, name: t.name, minPresent: t.minPresent, isDemo: t.isDemo, size: t.members.length }))}
        team={team ? { id: team.id, name: team.name, minPresent: team.minPresent, isDemo: team.isDemo } : null}
        members={members.map((m) => ({ id: m.id, displayName: m.displayName, isDemo: m.isDemo }))}
        absences={teamAbsences.map((a) => ({ id: a.id, personId: a.personId, startDate: a.startDate, endDate: a.endDate, status: a.status, isDemo: a.isDemo }))}
        series={series}
        alerts={coverageAlerts(series)}
        windows={findLowConcentrationWindows(series, windowDays)}
        windowDays={windowDays}
        start={start}
        end={end}
        today={now}
      />
    </>
  );
}
