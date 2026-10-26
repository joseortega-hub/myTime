import type { Metadata } from "next";
import { OptimizerView } from "@/components/optimizer-view";
import { PageHeader } from "@/components/ui";
import { yearOf } from "@/domain/dates";
import { today } from "@/server/context";
import { getBalances } from "@/server/services/absences";
import { listPlans } from "@/server/services/planning";
import { listTeams } from "@/server/services/team";

export const metadata: Metadata = { title: "Optimizador" };
export const dynamic = "force-dynamic";

export default async function OptimizerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const y = Number(sp["año"]);
  const year = Number.isInteger(y) && y >= yearOf(now) && y <= yearOf(now) + 2 ? y : yearOf(now);
  const [balances, plans, teams] = await Promise.all([getBalances(year), listPlans(), listTeams()]);
  const v = balances.find((b) => b.type === "VACATION")!;
  const free = v.available == null ? null : Math.max(0, v.available - v.requested - v.planned);
  return (
    <>
      <PageHeader
        title="Optimizador de vacaciones"
        description="Calcula las combinaciones de fechas que más descanso te dan con tus días. Funciona en local, sin IA ni costes. Guardar una propuesta solo crea una planificación personal."
      />
      <OptimizerView
        key={year}
        year={year}
        today={now}
        freeDays={free}
        teams={teams.filter((t) => t.members.length > 0).map((t) => ({ id: t.id, name: t.name, isDemo: t.isDemo, size: t.members.length }))}
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          year: p.year,
          createdAt: p.createdAt.toISOString(),
          absences: p.absences.map((a) => ({ startDate: a.startDate, endDate: a.endDate, status: a.status })),
        }))}
      />
    </>
  );
}
