import type { Metadata } from "next";
import { CompensatoryView } from "@/components/compensatory-view";
import { PageHeader } from "@/components/ui";
import { yearOf } from "@/domain/dates";
import { today } from "@/server/context";
import { getBalances } from "@/server/services/absences";
import { listCompensatoryGroups } from "@/server/services/compensatory";

export const metadata: Metadata = { title: "Compensados" };
export const dynamic = "force-dynamic";

export default async function CompensatoryPage() {
  const now = today();
  const year = yearOf(now);
  const [groups, balances] = await Promise.all([listCompensatoryGroups(), getBalances(year)]);
  const balance = balances.find((b) => b.type === "COMPENSATORY")!;
  const data = groups.map((g) => ({
    id: g.id,
    year: g.year,
    name: g.name,
    pickCount: g.pickCount,
    notes: g.notes,
    options: g.options.map((o) => ({
      id: o.id,
      startDate: o.startDate,
      endDate: o.endDate,
      label: o.label,
      absence: o.absence ? { id: o.absence.id, status: o.absence.status } : null,
    })),
  }));
  return (
    <>
      <PageHeader
        title="Compensados"
        description="Guarda todas las opciones de días compensados que os ofrecen, marca las que eliges y consulta las que quedaron sin elegir."
      />
      <CompensatoryView groups={data} today={now} currentYear={year} balance={balance} />
    </>
  );
}
