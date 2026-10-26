/**
 * Importación de festivos oficiales desde una fuente pública gratuita
 * (Nager.Date, https://date.nager.at). Solo se llama cuando el usuario pulsa
 * "Importar festivos" y solo se envían el país y el año.
 *
 * Limitaciones:
 * - Incluye festivos nacionales y autonómicos, NO los locales de cada municipio.
 * - La fuente no es oficial y puede omitir algún festivo autonómico: lo
 *   importado queda pendiente de revisión hasta que el usuario lo confirme.
 */
import { z } from "zod";
import type { HolidayInfo } from "@/domain/calendar";
import { isIsoDate } from "@/domain/dates";

export const HOLIDAY_SOURCE = "nager.date";
const BASE_URL = "https://date.nager.at/api/v3";

const apiHolidaySchema = z.object({
  date: z.string().refine(isIsoDate),
  localName: z.string(),
  name: z.string(),
  countryCode: z.string(),
  global: z.boolean(),
  counties: z.array(z.string()).nullable(),
  types: z.array(z.string()),
});
const apiResponseSchema = z.array(apiHolidaySchema);
export type ApiHoliday = z.infer<typeof apiHolidaySchema>;

export class HolidayProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HolidayProviderError";
  }
}

/** Filtra y clasifica: nacionales (global) y los de la región indicada. */
export function mapPublicHolidays(data: ApiHoliday[], regionCode: string | null): HolidayInfo[] {
  const out = new Map<string, HolidayInfo>();
  for (const h of data) {
    if (!h.types.includes("Public")) continue;
    if (h.global) {
      out.set(h.date, { date: h.date, name: h.localName, scope: "NATIONAL" });
    } else if (regionCode && h.counties?.includes(regionCode) && !out.has(h.date)) {
      out.set(h.date, { date: h.date, name: h.localName, scope: "REGIONAL" });
    }
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchPublicHolidays(
  year: number,
  countryCode: string,
  regionCode: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<HolidayInfo[]> {
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new HolidayProviderError("Código de país no válido.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HolidayProviderError("Año no válido.");
  let res: Response;
  try {
    res = await fetchImpl(`${BASE_URL}/PublicHolidays/${year}/${countryCode}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new HolidayProviderError("No se ha podido conectar con el servicio de festivos. Puedes introducirlos a mano o importar un archivo.");
  }
  if (res.status === 404) throw new HolidayProviderError("El servicio no tiene festivos para ese país.");
  if (!res.ok) throw new HolidayProviderError(`El servicio de festivos respondió con un error (${res.status}).`);
  const parsed = apiResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new HolidayProviderError("La respuesta del servicio de festivos no tiene el formato esperado.");
  return mapPublicHolidays(parsed.data, regionCode);
}
