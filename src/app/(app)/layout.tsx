import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getJiraStatus } from "@/server/services/integrations";
import { getAlerts } from "@/server/services/planning";

export const dynamic = "force-dynamic";

/** Marco de la aplicación (navegación y contador de alertas). Solo para usuarios con acceso. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let alertCount = 0;
  try {
    alertCount = (await getAlerts()).filter((a) => a.severity !== "info").length;
  } catch {
    // Si la base de datos no responde, la página mostrará el error correspondiente.
  }
  return (
    <AppShell alertCount={alertCount} jiraMode={getJiraStatus().mode}>
      {children}
    </AppShell>
  );
}
