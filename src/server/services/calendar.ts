import "server-only";
import { z } from "zod";
import { yearOf } from "@/domain/dates";
import { fetchPublicHolidays, HOLIDAY_SOURCE } from "@/integrations/holidays/public-holidays";
import { resolveSpanishRegion } from "@/integrations/holidays/spain-regions";
import { UserFacingError, WithWarnings } from "@/lib/result";
import { calendarSettingsSchema, holidayImportSchema, holidayInputSchema, parseHolidayCsv } from "@/lib/validation";
import { getCalendarContext, getCurrentUser } from "../context";
import { db } from "../db";

async function calendarId(): Promise<string> {
  const user = await getCurrentUser();
  return user.workCalendarId!;
}

export async function updateCalendarSettings(raw: unknown) {
  const input = calendarSettingsSchema.parse(raw);
  return db.workCalendar.update({
    where: { id: await calendarId() },
    data: {
      name: input.name,
      country: input.country ?? null,
      region: input.region ?? null,
      municipality: input.municipality ?? null,
      workingWeekdays: [...new Set(input.workingWeekdays)].sort(),
    },
  });
}

export async function addHoliday(raw: unknown) {
  const input = holidayInputSchema.parse(raw);
  const id = await calendarId();
  const existing = await db.holiday.findUnique({ where: { calendarId_date: { calendarId: id, date: input.date } } });
  if (existing) throw new UserFacingError(`Ya hay un festivo el ${input.date}: ${existing.name}.`);
  const h = await db.holiday.create({ data: { ...input, calendarId: id, source: "manual" } });
  await unverifyYear(yearOf(input.date));
  return h;
}

export async function deleteHoliday(id: string) {
  const res = await db.holiday.deleteMany({ where: { id, calendarId: await calendarId() } });
  if (res.count === 0) throw new UserFacingError("El festivo ya no existe.");
}

/** Cualquier cambio en los festivos de un año obliga a volver a confirmarlo. */
async function unverifyYear(year: number) {
  const cal = await db.workCalendar.findUniqueOrThrow({ where: { id: await calendarId() } });
  if (cal.verifiedYears.includes(year))
    await db.workCalendar.update({ where: { id: cal.id }, data: { verifiedYears: cal.verifiedYears.filter((y) => y !== year) } });
}

export async function setYearVerified(year: number, verified: boolean) {
  z.number().int().min(2000).max(2100).parse(year);
  const cal = await db.workCalendar.findUniqueOrThrow({ where: { id: await calendarId() } });
  const set = new Set(cal.verifiedYears);
  if (verified) set.add(year);
  else set.delete(year);
  return db.workCalendar.update({ where: { id: cal.id }, data: { verifiedYears: [...set].sort() } });
}

async function insertHolidays(rows: z.infer<typeof holidayImportSchema>, source: string) {
  const id = await calendarId();
  const existing = new Set((await db.holiday.findMany({ where: { calendarId: id }, select: { date: true } })).map((h) => h.date));
  const seen = new Set<string>();
  const toCreate = rows.filter((r) => {
    if (existing.has(r.date) || seen.has(r.date)) return false;
    seen.add(r.date);
    return true;
  });
  if (toCreate.length > 0) await db.holiday.createMany({ data: toCreate.map((r) => ({ ...r, calendarId: id, source })) });
  for (const y of new Set(toCreate.map((r) => yearOf(r.date)))) await unverifyYear(y);
  return { created: toCreate.length, skipped: rows.length - toCreate.length };
}

/** Importa un archivo CSV (fecha;nombre;ámbito) o JSON ([{date,name,scope}]). */
export async function importHolidaysFile(fileName: string, content: string) {
  if (content.length > 200_000) throw new UserFacingError("El archivo es demasiado grande.");
  let rows: unknown;
  const errors: string[] = [];
  if (fileName.toLowerCase().endsWith(".json")) {
    try {
      rows = JSON.parse(content);
    } catch {
      throw new UserFacingError("El archivo JSON no es válido.");
    }
  } else {
    const parsed = parseHolidayCsv(content);
    rows = parsed.rows;
    errors.push(...parsed.errors);
  }
  if (errors.length > 0) throw new UserFacingError(`El archivo tiene errores: ${errors.slice(0, 3).join(" ")}`);
  const result = holidayImportSchema.safeParse(rows);
  if (!result.success) {
    const i = result.error.issues[0];
    const where = typeof i.path[0] === "number" ? ` (registro ${i.path[0] + 1})` : "";
    throw new UserFacingError(`Datos no válidos${where}: ${i.message}`);
  }
  const safeName = fileName.replace(/[^\w.\-]/g, "_").slice(0, 60);
  return insertHolidays(result.data, `import:${safeName}`);
}

/**
 * Importa festivos nacionales y autonómicos desde la fuente pública, a partir
 * del país y la región/provincia configurados. No incluye festivos locales.
 */
export async function importPublicHolidays(year: number) {
  z.number().int().min(2000).max(2100).parse(year);
  const { calendar } = await getCalendarContext();
  const country = (calendar.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new UserFacingError("Indica el país con su código de dos letras (p. ej. ES) en el calendario laboral.");
  let regionCode: string | null = null;
  const warnings: string[] = [];
  if (country === "ES") {
    const region = resolveSpanishRegion(calendar.region) ?? resolveSpanishRegion(calendar.municipality);
    if (!region) warnings.push("No se ha reconocido la comunidad o provincia: solo se importan festivos nacionales.");
    regionCode = region?.code ?? null;
  } else if (calendar.region) {
    regionCode = calendar.region.trim().toUpperCase();
  }
  const holidays = await fetchPublicHolidays(year, country, regionCode);
  const res = await insertHolidays(holidays, HOLIDAY_SOURCE);
  warnings.push(
    "Los festivos locales del municipio no están incluidos: añádelos a mano o importa un archivo.",
    "Fuente pública no oficial: revisa el listado con el boletín oficial antes de marcar el año como completo.",
  );
  return new WithWarnings({ ...res, regionCode }, warnings);
}
