"use server";
/**
 * Acciones de servidor: único punto de escritura desde la interfaz.
 * Cada acción valida los datos en el servidor (los servicios usan Zod) y
 * devuelve un ActionResult sin exponer detalles internos.
 * Next.js comprueba que el origen de la petición coincide con el host.
 */
import { revalidatePath } from "next/cache";
import type { AbsenceStatus, AbsenceType } from "@/domain/absences";
import { runAction } from "@/lib/result";
import * as absences from "@/server/services/absences";
import * as calendar from "@/server/services/calendar";
import * as compensatory from "@/server/services/compensatory";
import * as dataTransfer from "@/server/services/data-transfer";
import * as hours from "@/server/services/hours";
import * as integrations from "@/server/services/integrations";
import * as notifications from "@/server/services/notifications";
import * as oncall from "@/server/services/oncall";
import * as planning from "@/server/services/planning";
import * as team from "@/server/services/team";

function done() {
  revalidatePath("/", "layout");
}

async function act<T>(fn: () => Promise<T>) {
  const r = await runAction(fn);
  if (r.ok) done();
  return r;
}

// Ausencias
export const createAbsenceAction = async (input: unknown) => act(() => absences.createAbsence(input));
export const updateAbsenceAction = async (id: string, input: unknown) => act(() => absences.updateAbsence(id, input));
export const changeAbsenceStatusAction = async (id: string, status: AbsenceStatus, note?: string) =>
  act(() => absences.changeAbsenceStatus({ id, status, note }));
export const deleteAbsenceAction = async (id: string) => act(() => absences.deleteAbsence(id));

// Saldos
export const upsertBalanceAction = async (input: unknown) => act(() => absences.upsertBalance(input));
export const deleteBalanceAction = async (year: number, type: AbsenceType) => act(() => absences.deleteBalance(year, type));

// Calendario laboral
export const updateCalendarAction = async (input: unknown) => act(() => calendar.updateCalendarSettings(input));
export const addHolidayAction = async (input: unknown) => act(() => calendar.addHoliday(input));
export const deleteHolidayAction = async (id: string) => act(() => calendar.deleteHoliday(id));
export const setYearVerifiedAction = async (year: number, verified: boolean) => act(() => calendar.setYearVerified(year, verified));
export const importHolidaysFileAction = async (fileName: string, content: string) => act(() => calendar.importHolidaysFile(fileName, content));
export const importPublicHolidaysAction = async (year: number) => act(() => calendar.importPublicHolidays(year));

// Compensados
export const createCompensatoryGroupAction = async (input: unknown) => act(() => compensatory.createCompensatoryGroup(input));
export const deleteCompensatoryGroupAction = async (id: string) => act(() => compensatory.deleteCompensatoryGroup(id));
export const chooseCompensatoryOptionAction = async (input: unknown) => act(() => compensatory.chooseCompensatoryOption(input));
export const unchooseCompensatoryOptionAction = async (optionId: string) => act(() => compensatory.unchooseCompensatoryOption(optionId));

// Optimizador y planificaciones (nunca crean solicitudes externas)
export const runOptimizerAction = async (input: unknown) => runAction(() => planning.runOptimizer(input));
export const savePlanAction = async (input: unknown) => act(() => planning.savePlan(input));
export const deletePlanAction = async (id: string) => act(() => planning.deletePlan(id));

// Alertas
export const dismissAlertAction = async (key: string, dismissed: boolean) => act(() => planning.dismissAlert(key, dismissed));
export const saveAlertRulesAction = async (input: unknown) => act(() => planning.saveAlertRules(input));

// Equipo
export const createTeamAction = async (input: unknown) => act(() => team.createTeam(input));
export const updateTeamAction = async (id: string, input: unknown) => act(() => team.updateTeam(id, input));
export const deleteTeamAction = async (id: string) => act(() => team.deleteTeam(id));
export const createPersonAction = async (input: unknown) => act(() => team.createPerson(input));
export const deletePersonAction = async (id: string) => act(() => team.deletePerson(id));
export const createTeamAbsenceAction = async (input: unknown) => act(() => team.createTeamAbsence(input));
export const deleteTeamAbsenceAction = async (id: string) => act(() => team.deleteTeamAbsence(id));
export const seedDemoTeamAction = async () => act(() => team.seedDemoTeam());
export const clearDemoDataAction = async () => act(() => team.clearDemoData());

// Horas
export const updateScheduleAction = async (input: unknown) => act(() => hours.updateSchedule(input));
export const saveWorkItemAction = async (id: string | null, input: unknown) => act(() => hours.saveWorkItem(id, input));
export const deleteWorkItemAction = async (id: string) => act(() => hours.deleteWorkItem(id));
export const interpretHoursAction = async (text: string, referenceDate: string) => runAction(() => hours.interpretText(text, referenceDate));
export const createTimeEntriesAction = async (input: unknown) => act(() => hours.createTimeEntries(input));
export const updateTimeEntryAction = async (id: string, input: unknown) => act(() => hours.updateTimeEntry(id, input));
export const deleteTimeEntryAction = async (id: string) => act(() => hours.deleteTimeEntry(id));
export const pushEntriesToJiraAction = async (ids: string[]) => act(() => hours.pushEntriesToJira(ids));

// Integraciones y datos
export const testJiraConnectionAction = async () => runAction(() => integrations.testJiraConnection());
export const syncMyAbsencesAction = async (year: number) => act(() => integrations.syncMyAbsences(year));
export const importDataAction = async (content: string) => act(() => dataTransfer.importData(content));

// Guardias
export const saveOnCallAction = async (id: string | null, input: unknown) => act(() => oncall.saveOnCall(id, input));
export const deleteOnCallAction = async (id: string) => act(() => oncall.deleteOnCall(id));

// Notificaciones push (solo se guardan suscripciones; los avisos los envía el programador)
export const savePushSubscriptionAction = async (input: unknown) => act(() => notifications.saveSubscription(input));
export const deletePushSubscriptionAction = async (endpoint: string) => act(() => notifications.deleteSubscription(endpoint));
export const sendTestPushAction = async () => runAction(() => notifications.sendTestNotification());
