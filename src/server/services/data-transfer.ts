import "server-only";
/**
 * Exportación e importación de los datos personales.
 * La importación valida TODO el archivo antes de escribir y se aplica en una
 * única transacción: o entra todo o no entra nada. Los duplicados se omiten.
 */
import { UserFacingError, WithWarnings } from "@/lib/result";
import { exportSchema, type ExportData } from "@/lib/validation";
import { getCalendarContext } from "../context";
import { db } from "../db";

export async function buildExport(): Promise<ExportData> {
  const { user, calendar } = await getCalendarContext();
  const [balances, absences, schedule, workItems, entries] = await Promise.all([
    db.annualBalance.findMany({ where: { userId: user.id } }),
    db.absence.findMany({ where: { userId: user.id }, orderBy: { startDate: "asc" } }),
    db.workScheduleDay.findMany({ where: { userId: user.id }, orderBy: { weekday: "asc" } }),
    db.workItem.findMany({ where: { userId: user.id } }),
    db.timeEntry.findMany({ where: { userId: user.id }, include: { workItem: true }, orderBy: { date: "asc" } }),
  ]);
  return {
    format: "mytime-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: { displayName: user.displayName, timezone: user.timezone },
    calendar: {
      name: calendar.name,
      country: calendar.country,
      region: calendar.region,
      municipality: calendar.municipality,
      workingWeekdays: calendar.workingWeekdays,
      verifiedYears: calendar.verifiedYears,
    },
    holidays: calendar.holidays.map((h) => ({ date: h.date, name: h.name, scope: h.scope })),
    balances: balances.map((b) => ({
      year: b.year, absenceType: b.absenceType as "VACATION" | "COMPENSATORY" | "PERSONAL_DAY",
      allocatedDays: b.allocatedDays, carryOverDays: b.carryOverDays, source: b.source, notes: b.notes,
    })),
    absences: absences.map((a) => ({
      type: a.type, status: a.status, startDate: a.startDate, endDate: a.endDate,
      portion: a.portion, daysOverride: a.daysOverride, notes: a.notes,
    })),
    schedule: schedule.map(({ weekday, startTime, endTime, breakMinutes }) => ({ weekday, startTime, endTime, breakMinutes })),
    workItems: workItems.map((w) => ({ label: w.label, projectName: w.projectName, jiraIssueKey: w.jiraIssueKey, aliases: w.aliases, active: w.active })),
    timeEntries: entries.map((e) => ({ date: e.date, workItemLabel: e.workItem.label, minutes: e.minutes, description: e.description })),
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Evita inyección de fórmulas al abrir el CSV en una hoja de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function buildAbsencesCsv(): Promise<string> {
  const data = await buildExport();
  const header = ["tipo", "estado", "inicio", "fin", "jornada", "dias_indicados", "notas"];
  const rows = data.absences.map((a) => [a.type, a.status, a.startDate, a.endDate, a.portion, a.daysOverride, a.notes].map(csvCell).join(";"));
  return [header.join(";"), ...rows].join("\n");
}

export async function buildTimeEntriesCsv(): Promise<string> {
  const data = await buildExport();
  const header = ["fecha", "proyecto", "minutos", "descripcion"];
  const rows = data.timeEntries.map((e) => [e.date, e.workItemLabel, e.minutes, e.description].map(csvCell).join(";"));
  return [header.join(";"), ...rows].join("\n");
}

export async function importData(content: string) {
  if (content.length > 10_000_000) throw new UserFacingError("El archivo es demasiado grande (máx. 10 MB).");
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new UserFacingError("El archivo no es un JSON válido.");
  }
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new UserFacingError(`El archivo no tiene el formato de exportación de MyTime (${i.path.join(".") || "raíz"}: ${i.message}).`);
  }
  const data = parsed.data;
  const { user, calendar } = await getCalendarContext();

  const counts = { holidays: 0, balances: 0, absences: 0, workItems: 0, timeEntries: 0, skipped: 0 };
  await db.$transaction(
    async (tx) => {
      const existingDates = new Set(calendar.holidays.map((h) => h.date));
      for (const h of data.holidays) {
        if (existingDates.has(h.date)) { counts.skipped++; continue; }
        existingDates.add(h.date);
        await tx.holiday.create({ data: { ...h, calendarId: calendar.id, source: "import:backup" } });
        counts.holidays++;
      }
      for (const b of data.balances) {
        await tx.annualBalance.upsert({
          where: { userId_year_absenceType: { userId: user.id, year: b.year, absenceType: b.absenceType } },
          update: { allocatedDays: b.allocatedDays, carryOverDays: b.carryOverDays, source: b.source, notes: b.notes ?? null },
          create: { userId: user.id, year: b.year, absenceType: b.absenceType, allocatedDays: b.allocatedDays, carryOverDays: b.carryOverDays, source: b.source, notes: b.notes ?? null },
        });
        counts.balances++;
      }
      const existingAbs = await tx.absence.findMany({ where: { userId: user.id } });
      const sig = (a: { type: string; status: string; startDate: string; endDate: string; portion: string }) => `${a.type}|${a.status}|${a.startDate}|${a.endDate}|${a.portion}`;
      const absSigs = new Set(existingAbs.map(sig));
      for (const a of data.absences) {
        if (absSigs.has(sig(a))) { counts.skipped++; continue; }
        absSigs.add(sig(a));
        await tx.absence.create({ data: { ...a, userId: user.id, origin: "import", events: { create: { toStatus: a.status, note: "Importada" } } } });
        counts.absences++;
      }
      const items = new Map((await tx.workItem.findMany({ where: { userId: user.id } })).map((w) => [w.label, w.id]));
      for (const w of data.workItems) {
        if (items.has(w.label)) { counts.skipped++; continue; }
        const created = await tx.workItem.create({ data: { ...w, projectName: w.projectName ?? null, jiraIssueKey: w.jiraIssueKey ?? null, userId: user.id } });
        items.set(w.label, created.id);
        counts.workItems++;
      }
      const existingEntries = await tx.timeEntry.findMany({ where: { userId: user.id }, include: { workItem: true } });
      const entrySigs = new Set(existingEntries.map((e) => `${e.date}|${e.workItem.label}|${e.minutes}|${e.description ?? ""}`));
      for (const e of data.timeEntries) {
        const workItemId = items.get(e.workItemLabel);
        const s = `${e.date}|${e.workItemLabel}|${e.minutes}|${e.description ?? ""}`;
        if (!workItemId || entrySigs.has(s)) { counts.skipped++; continue; }
        entrySigs.add(s);
        await tx.timeEntry.create({ data: { date: e.date, minutes: e.minutes, description: e.description, workItemId, userId: user.id } });
        counts.timeEntries++;
      }
    },
    { timeout: 60_000 },
  );
  return new WithWarnings(counts, counts.skipped > 0 ? [`${counts.skipped} registros ya existían y se han omitido.`] : []);
}
