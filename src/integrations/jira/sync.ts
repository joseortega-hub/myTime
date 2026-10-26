/**
 * Sincronización de ausencias externas (solo lectura hacia Jira).
 *
 * - Identifica cada registro por (fuente, id externo) → evita duplicados.
 * - Actualiza los registros que han cambiado.
 * - Los registros que desaparecen de la fuente dentro del rango consultado
 *   se marcan como CANCELADOS (no se borran) para no perder historial.
 * - Nunca modifica registros creados manualmente por el usuario.
 */
import type { IsoDate } from "@/domain/dates";
import type { ExternalAbsence } from "./types";

export interface StoredExternalAbsence extends ExternalAbsence {
  id: string;
}

export interface ExternalAbsenceStore {
  listExternal(source: string, range: { start: IsoDate; end: IsoDate }): Promise<StoredExternalAbsence[]>;
  create(source: string, a: ExternalAbsence, syncedAt: Date): Promise<void>;
  update(id: string, a: ExternalAbsence, syncedAt: Date): Promise<void>;
  markRemoved(id: string, syncedAt: Date): Promise<void>;
  touch(id: string, syncedAt: Date): Promise<void>;
}

export interface SyncCounts {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
}

function changed(a: StoredExternalAbsence, b: ExternalAbsence): boolean {
  return a.type !== b.type || a.status !== b.status || a.startDate !== b.startDate || a.endDate !== b.endDate || a.portion !== b.portion;
}

export async function syncExternalAbsences(
  source: string,
  incoming: ExternalAbsence[],
  store: ExternalAbsenceStore,
  range: { start: IsoDate; end: IsoDate },
  now: Date = new Date(),
): Promise<SyncCounts> {
  const counts: SyncCounts = { created: 0, updated: 0, removed: 0, unchanged: 0 };
  const existing = await store.listExternal(source, range);
  const byId = new Map(existing.map((e) => [e.externalId, e]));
  const seen = new Set<string>();

  for (const a of incoming) {
    if (seen.has(a.externalId)) continue; // la fuente devolvió el mismo registro dos veces
    seen.add(a.externalId);
    const current = byId.get(a.externalId);
    if (!current) {
      await store.create(source, a, now);
      counts.created++;
    } else if (changed(current, a)) {
      await store.update(current.id, a, now);
      counts.updated++;
    } else {
      await store.touch(current.id, now);
      counts.unchanged++;
    }
  }

  for (const e of existing) {
    if (!seen.has(e.externalId) && e.status !== "CANCELLED") {
      await store.markRemoved(e.id, now);
      counts.removed++;
    }
  }
  return counts;
}
