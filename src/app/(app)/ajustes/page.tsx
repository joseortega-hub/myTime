import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { PageHeader } from "@/components/ui";
import { yearOf } from "@/domain/dates";
import { SPAIN_REGIONS } from "@/integrations/holidays/spain-regions";
import { getCalendarContext, today } from "@/server/context";
import { listBalanceConfigs } from "@/server/services/absences";
import { getSchedule } from "@/server/services/hours";
import { getJiraStatus, lastSyncRuns } from "@/server/services/integrations";
import { listSubscriptions, publicPushKey } from "@/server/services/notifications";
import { authConfig } from "@/lib/session";

export const metadata: Metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const y = Number(sp["año"]);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : yearOf(now);
  const { calendar } = await getCalendarContext();
  const [balances, schedule, runs, subscriptions] = await Promise.all([listBalanceConfigs(), getSchedule(), lastSyncRuns(), listSubscriptions()]);

  return (
    <>
      <PageHeader title="Ajustes" description="Calendario laboral, saldos, jornada, integraciones y copias de tus datos." />
      <SettingsView
        year={year}
        currentYear={yearOf(now)}
        calendar={{
          name: calendar.name,
          country: calendar.country,
          region: calendar.region,
          municipality: calendar.municipality,
          workingWeekdays: calendar.workingWeekdays,
          verifiedYears: calendar.verifiedYears,
        }}
        holidays={calendar.holidays
          .filter((h) => yearOf(h.date) === year)
          .map((h) => ({ id: h.id, date: h.date, name: h.name, scope: h.scope, source: h.source }))}
        regions={SPAIN_REGIONS.map((r) => ({ code: r.code, name: r.name, provinces: r.provinces }))}
        balances={balances.map((b) => ({ year: b.year, absenceType: b.absenceType, allocatedDays: b.allocatedDays, carryOverDays: b.carryOverDays, source: b.source, notes: b.notes }))}
        schedule={schedule}
        jira={getJiraStatus()}
        push={{ publicKey: publicPushKey(), subscriptions }}
        authEnabled={authConfig().enabled}
        runs={runs.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, status: r.status, created: r.created, updated: r.updated, removed: r.removed, unchanged: r.unchanged, errorMessage: r.errorMessage, startedAt: r.startedAt.toISOString() }))}
      />
    </>
  );
}
