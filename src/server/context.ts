import "server-only";
/**
 * Contexto del usuario actual. En modo personal hay un único perfil local con
 * identificador fijo; en una versión corporativa se resolvería desde la sesión SSO.
 */
import { CalendarIndex, type WorkCalendarRules } from "@/domain/calendar";
import { todayIso } from "@/domain/dates";
import { DEFAULT_SCHEDULE } from "@/domain/hours/schedule";
import { db } from "./db";

export const LOCAL_USER_ID = "local-user";

export function appTimezone(): string {
  return process.env.MYTIME_TIMEZONE || "Europe/Madrid";
}

export function today(): string {
  return todayIso(appTimezone());
}

export const LOCAL_CALENDAR_ID = "local-calendar";

let bootstrapping: Promise<void> | null = null;

/**
 * Primer arranque: crea perfil, calendario (sin festivos) y jornada por defecto.
 * Idempotente y seguro ante peticiones simultáneas (ids fijos + reintento).
 */
async function bootstrap(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.workCalendar.upsert({
        where: { id: LOCAL_CALENDAR_ID },
        update: {},
        create: { id: LOCAL_CALENDAR_ID, name: "Mi calendario laboral", country: "ES", workingWeekdays: [1, 2, 3, 4, 5] },
      });
      const before = await db.userProfile.findUnique({ where: { id: LOCAL_USER_ID } });
      if (!before) {
        await db.userProfile.create({
          data: { id: LOCAL_USER_ID, displayName: "Yo", timezone: appTimezone(), workCalendarId: LOCAL_CALENDAR_ID },
        });
        await db.workScheduleDay.createMany({
          data: DEFAULT_SCHEDULE.map((d) => ({ ...d, userId: LOCAL_USER_ID })),
          skipDuplicates: true,
        });
      } else if (!before.workCalendarId) {
        await db.userProfile.update({ where: { id: LOCAL_USER_ID }, data: { workCalendarId: LOCAL_CALENDAR_ID } });
      }
      return;
    } catch (e) {
      // Otra petición creó el registro a la vez: se vuelve a intentar leyendo.
      if ((e as { code?: string }).code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}

export async function getCurrentUser() {
  const existing = await db.userProfile.findUnique({ where: { id: LOCAL_USER_ID } });
  if (existing?.workCalendarId) return existing;
  bootstrapping ??= bootstrap().finally(() => {
    bootstrapping = null;
  });
  await bootstrapping;
  return db.userProfile.findUniqueOrThrow({ where: { id: LOCAL_USER_ID } });
}

export async function getCalendarContext() {
  const user = await getCurrentUser();
  const cal = await db.workCalendar.findUniqueOrThrow({
    where: { id: user.workCalendarId! },
    include: { holidays: { orderBy: { date: "asc" } } },
  });
  const rules: WorkCalendarRules = {
    workingWeekdays: cal.workingWeekdays,
    verifiedYears: cal.verifiedYears,
    holidays: cal.holidays.map((h) => ({ date: h.date, name: h.name, scope: h.scope })),
  };
  return { user, calendar: cal, rules, index: new CalendarIndex(rules) };
}
