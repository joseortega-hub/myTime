import type { Metadata } from "next";
import { HoursView } from "@/components/hours-view";
import { PageHeader } from "@/components/ui";
import { isIsoDate, startOfWeek } from "@/domain/dates";
import { today } from "@/server/context";
import { getWeek, listWorkItems } from "@/server/services/hours";
import { getJiraStatus } from "@/server/services/integrations";

export const metadata: Metadata = { title: "Horas" };
export const dynamic = "force-dynamic";

export default async function HoursPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const weekStart = startOfWeek(isIsoDate(sp.semana) ? sp.semana : now);
  const [week, items] = await Promise.all([getWeek(weekStart), listWorkItems(true)]);
  const jira = getJiraStatus();
  return (
    <>
      <PageHeader
        title="Horas por proyecto"
        description="Escribe o dicta lo que has hecho; MyTime lo interpreta sin IA y te muestra una vista previa antes de guardar."
      />
      <HoursView
        today={now}
        weekStart={weekStart}
        week={week.map((d) => ({
          date: d.date,
          working: d.working,
          holiday: d.holiday?.name ?? null,
          expected: d.expected,
          logged: d.logged,
          entries: d.entries.map((e) => ({
            id: e.id, date: e.date, workItemId: e.workItemId, minutes: e.minutes, description: e.description,
            syncStatus: e.syncStatus, syncError: e.syncError, label: e.workItem.label, issueKey: e.workItem.jiraIssueKey,
          })),
        }))}
        items={items.map((i) => ({ id: i.id, label: i.label, projectName: i.projectName, jiraIssueKey: i.jiraIssueKey, aliases: i.aliases, active: i.active }))}
        jira={{ mode: jira.mode, writeEnabled: jira.mode === "mock" || (jira.mode === "live" && jira.writeEnabled && jira.problems.length === 0) }}
      />
    </>
  );
}
