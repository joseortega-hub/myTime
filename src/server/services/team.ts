import "server-only";
import { addDays } from "@/domain/dates";
import { UserFacingError } from "@/lib/result";
import { personInputSchema, teamAbsenceInputSchema, teamInputSchema } from "@/lib/validation";
import { today } from "../context";
import { db } from "../db";

export async function listTeams() {
  return db.team.findMany({
    orderBy: { name: "asc" },
    include: { members: { orderBy: { displayName: "asc" } } },
  });
}

export async function listTeamAbsences(start: string, end: string) {
  return db.teamAbsence.findMany({
    where: { startDate: { lte: end }, endDate: { gte: start } },
    // Solo los campos necesarios para la disponibilidad.
    select: { id: true, personId: true, startDate: true, endDate: true, portion: true, status: true, isDemo: true, source: true },
    orderBy: { startDate: "asc" },
  });
}

export async function createTeam(raw: unknown) {
  const input = teamInputSchema.parse(raw);
  return db.team.create({ data: { name: input.name, minPresent: input.minPresent ?? null } });
}

export async function updateTeam(id: string, raw: unknown) {
  const input = teamInputSchema.parse(raw);
  return db.team.update({ where: { id }, data: { name: input.name, minPresent: input.minPresent ?? null } });
}

export async function deleteTeam(id: string) {
  await db.team.delete({ where: { id } });
}

export async function createPerson(raw: unknown) {
  const input = personInputSchema.parse(raw);
  const team = await db.team.findUnique({ where: { id: input.teamId } });
  if (!team) throw new UserFacingError("El equipo no existe.");
  return db.person.create({ data: { displayName: input.displayName, teamId: team.id, isDemo: team.isDemo } });
}

export async function deletePerson(id: string) {
  await db.person.delete({ where: { id } });
}

export async function createTeamAbsence(raw: unknown) {
  const input = teamAbsenceInputSchema.parse(raw);
  const person = await db.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new UserFacingError("La persona no existe.");
  return db.teamAbsence.create({ data: { ...input, isDemo: person.isDemo } });
}

export async function deleteTeamAbsence(id: string) {
  await db.teamAbsence.delete({ where: { id } });
}

/**
 * Datos de DEMOSTRACIÓN claramente identificados: equipo "Equipo demo",
 * personas "Persona demo N". Se pueden borrar de una vez.
 */
export async function seedDemoTeam() {
  const existing = await db.team.findFirst({ where: { isDemo: true } });
  if (existing) throw new UserFacingError("Los datos de demostración ya están cargados.");
  const base = today();
  return db.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name: "Equipo demo", minPresent: 3, isDemo: true } });
    const offsets: [number, number, "CONFIRMED" | "TENTATIVE"][][] = [
      [[5, 9, "CONFIRMED"], [40, 44, "CONFIRMED"]],
      [[7, 8, "CONFIRMED"], [58, 66, "TENTATIVE"]],
      [[6, 9, "TENTATIVE"], [30, 31, "CONFIRMED"]],
      [[20, 24, "CONFIRMED"], [60, 64, "CONFIRMED"]],
      [[61, 65, "CONFIRMED"]],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const p = await tx.person.create({ data: { displayName: `Persona demo ${i + 1}`, teamId: team.id, isDemo: true } });
      for (const [s, e, status] of offsets[i]) {
        await tx.teamAbsence.create({
          data: { personId: p.id, startDate: addDays(base, s), endDate: addDays(base, e), status, isDemo: true, source: "demo" },
        });
      }
    }
    return team;
  });
}

export async function clearDemoData() {
  await db.$transaction([
    db.team.deleteMany({ where: { isDemo: true } }),
    db.workItem.deleteMany({ where: { isDemo: true, entries: { none: {} } } }),
  ]);
}
