import { buildAbsencesCsv, buildExport, buildTimeEntriesCsv } from "@/server/services/data-transfer";

export const dynamic = "force-dynamic";

/** Descarga de los datos personales: JSON completo o CSV de ausencias/horas. */
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = (type: string, name: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  try {
    if (format === "absences-csv") {
      return new Response("﻿" + (await buildAbsencesCsv()), { headers: headers("text/csv; charset=utf-8", `mytime-ausencias-${stamp}.csv`) });
    }
    if (format === "hours-csv") {
      return new Response("﻿" + (await buildTimeEntriesCsv()), { headers: headers("text/csv; charset=utf-8", `mytime-horas-${stamp}.csv`) });
    }
    if (format !== "json") return new Response("Formato no válido", { status: 400 });
    return new Response(JSON.stringify(await buildExport(), null, 2), {
      headers: headers("application/json; charset=utf-8", `mytime-copia-${stamp}.json`),
    });
  } catch {
    return new Response("No se ha podido generar la exportación.", { status: 500 });
  }
}
