import type { Metadata } from "next";
import { AbsenceList } from "@/components/absence-list";
import { NewAbsenceButton } from "@/components/new-absence-button";
import { PageHeader } from "@/components/ui";
import { ABSENCE_STATUSES, ABSENCE_TYPES, computeConsumption, type AbsenceStatus, type AbsenceType } from "@/domain/absences";
import { yearOf } from "@/domain/dates";
import { getCalendarContext, today } from "@/server/context";
import { listAbsences } from "@/server/services/absences";

export const metadata: Metadata = { title: "Ausencias" };
export const dynamic = "force-dynamic";

export default async function AbsencesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const y = Number(sp["año"]);
  const year = sp["año"] === "todos" ? undefined : Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : yearOf(now);
  const status = ABSENCE_STATUSES.includes(sp.estado as AbsenceStatus) ? (sp.estado as AbsenceStatus) : undefined;
  const type = ABSENCE_TYPES.includes(sp.tipo as AbsenceType) ? (sp.tipo as AbsenceType) : undefined;

  const { rules, index } = await getCalendarContext();
  const absences = await listAbsences({ year, status, type });
  const rows = absences.map((a) => ({
    id: a.id, type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate, portion: a.portion,
    daysOverride: a.daysOverride, notes: a.notes, origin: a.origin, externalSource: a.externalSource,
    days: computeConsumption(a, index).total,
    events: a.events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, at: e.at.toISOString() })),
  }));

  return (
    <>
      <PageHeader
        title="Mis ausencias"
        description="Solicitudes, vacaciones aprobadas, disfrutadas y rechazadas. Todo se guarda solo en MyTime."
        actions={<NewAbsenceButton rules={rules} defaultDate={now} />}
      />
      <AbsenceList rows={rows} rules={rules} year={year ?? null} status={status ?? null} type={type ?? null} currentYear={yearOf(now)} />
    </>
  );
}
