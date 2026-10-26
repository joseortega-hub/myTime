import type { Metadata } from "next";
import { AlertsView } from "@/components/alerts-view";
import { PageHeader } from "@/components/ui";
import { getAlertRules, getAlerts } from "@/server/services/planning";

export const metadata: Metadata = { title: "Alertas" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const [alerts, rules] = await Promise.all([getAlerts(true), getAlertRules()]);
  return (
    <>
      <PageHeader
        title="Alertas y recordatorios"
        description="Se calculan al abrir la aplicación a partir de tus fechas y reglas. Los recordatorios solo llegan al móvil si activas los avisos en Ajustes; nunca se envían correos."
      />
      <AlertsView alerts={alerts} rules={rules} />
    </>
  );
}
