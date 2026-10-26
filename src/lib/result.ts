import { ZodError } from "zod";
import { fieldErrors, firstError } from "./validation";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; warnings?: string[] }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** El usuario puede confirmar y reintentar (p. ej. solapamientos). */
      needsConfirmation?: boolean;
    };

/** Error de negocio con un mensaje seguro para mostrar al usuario. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly options: { needsConfirmation?: boolean } = {},
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) return { ok: false, error: firstError(e), fieldErrors: fieldErrors(e) };
  if (e instanceof UserFacingError) return { ok: false, error: e.message, needsConfirmation: e.options.needsConfirmation };
  if (e instanceof Error && e.name === "JiraError") return { ok: false, error: e.message };
  if (e instanceof Error && e.name === "HolidayProviderError") return { ok: false, error: e.message };
  const code = (e as { code?: string })?.code;
  if (code === "P2002") return { ok: false, error: "Ya existe un registro con esos datos." };
  if (code === "P2025") return { ok: false, error: "El registro ya no existe. Recarga la página." };
  if (code === "P2003") return { ok: false, error: "No se puede eliminar: hay otros datos que dependen de este registro." };
  if (code === "P1001" || code === "P1002") return { ok: false, error: "No se puede conectar con la base de datos. ¿Está PostgreSQL en marcha?" };
  // Solo se registra el tipo de error, nunca los datos de la petición.
  console.error("[mytime] Error inesperado:", e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "desconocido");
  return { ok: false, error: "Se ha producido un error inesperado. Inténtalo de nuevo." };
}

/** Resultado correcto acompañado de avisos para el usuario. */
export class WithWarnings<T> {
  constructor(
    readonly data: T,
    readonly warnings: string[],
  ) {}
}

export type Unwrap<R> = R extends WithWarnings<infer U> ? U : R;

export async function runAction<R>(fn: () => Promise<R>): Promise<ActionResult<Unwrap<R>>> {
  try {
    const r = await fn();
    if (r instanceof WithWarnings) return { ok: true, data: r.data as Unwrap<R>, warnings: r.warnings };
    return { ok: true, data: r as Unwrap<R> };
  } catch (e) {
    return toActionError(e);
  }
}
