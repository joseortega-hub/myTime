import type { Metadata } from "next";
import { OnCallView } from "@/components/oncall-view";
import { PageHeader } from "@/components/ui";
import { yearOf } from "@/domain/dates";
import { summarizeOnCall } from "@/domain/oncall";
import { today } from "@/server/context";
import { listOnCall } from "@/server/services/oncall";

export const metadata: Metadata = { title: "Guardias" };
export const dynamic = "force-dynamic";

export default async function OnCallPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const y = Number(sp["año"]);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : yearOf(now);
  const shifts = await listOnCall(year);
  const rows = shifts.map((s) => ({
    id: s.id, startDate: s.startDate, endDate: s.endDate, startTime: s.startTime, endTime: s.endTime, kind: s.kind,
    status: s.status, workedMinutes: s.workedMinutes, compensation: s.compensation, compensationDays: s.compensationDays,
    jiraIssueKey: s.jiraIssueKey, notes: s.notes,
  }));
  return (
    <>
      <PageHeader title="Guardias" description="Registra tus guardias, las horas de intervención y cómo se compensan. Te aviso una semana antes y el día anterior." />
      <OnCallView year={year} currentYear={yearOf(now)} today={now} shifts={rows} summary={summarizeOnCall(rows, year, now)} />
    </>
  );
}
