/**
 * Contratos de la integración con Jira. El resto de la aplicación solo
 * conoce estas interfaces, nunca el adaptador concreto.
 */
import type { AbsenceStatus, AbsenceType, DayPortion } from "@/domain/absences";
import type { IsoDate } from "@/domain/dates";

export type JiraMode = "disabled" | "mock" | "live";

/** Ausencia propia leída de una fuente externa. */
export interface ExternalAbsence {
  externalId: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: IsoDate;
  endDate: IsoDate;
  portion: DayPortion;
  updatedAt: string | null;
}

/** Ausencia de un compañero: solo disponibilidad, sin motivos ni descripciones. */
export interface ExternalTeamAbsence {
  externalId: string;
  personExternalId: string;
  personDisplayName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: "CONFIRMED" | "TENTATIVE";
}

export interface WorklogToWrite {
  issueKey: string;
  date: IsoDate;
  minutes: number;
  comment: string | null;
}

export interface ConnectionInfo {
  ok: boolean;
  accountDisplayName: string | null;
  message: string;
}

/** Puerto de lectura (la integración inicial es solo de lectura). */
export interface AbsenceSource {
  readonly mode: JiraMode;
  checkConnection(): Promise<ConnectionInfo>;
  listMyAbsences(range: { start: IsoDate; end: IsoDate }): Promise<ExternalAbsence[]>;
  /** Solo si la fuente lo autoriza; si no, lanza JiraError("forbidden"). */
  listTeamAbsences(teamKey: string, range: { start: IsoDate; end: IsoDate }): Promise<ExternalTeamAbsence[]>;
}

/** Puerto de escritura de imputaciones. Desactivado salvo configuración explícita. */
export interface WorklogSink {
  readonly mode: JiraMode;
  readonly writeEnabled: boolean;
  addWorklog(worklog: WorklogToWrite): Promise<{ worklogId: string }>;
}

export type JiraErrorKind =
  | "not_configured"
  | "write_disabled"
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response"
  | "mapping";

const MESSAGES: Record<JiraErrorKind, string> = {
  not_configured: "La integración con Jira no está configurada.",
  write_disabled: "La escritura en Jira está desactivada (la integración es de solo lectura).",
  auth: "Jira ha rechazado las credenciales. Revisa el token configurado en el servidor.",
  forbidden: "No tienes permiso para consultar esos datos en Jira.",
  not_found: "Jira no encuentra el recurso solicitado. Revisa la configuración de mapeo.",
  rate_limited: "Jira ha limitado las peticiones. Inténtalo de nuevo más tarde.",
  server: "Jira ha devuelto un error interno.",
  network: "No se ha podido conectar con Jira.",
  timeout: "Jira no ha respondido a tiempo.",
  invalid_response: "La respuesta de Jira no tiene el formato esperado.",
  mapping: "La configuración de mapeo de campos de Jira no es válida.",
};

/** Error saneado: el mensaje nunca contiene tokens, cabeceras ni cuerpos de respuesta. */
export class JiraError extends Error {
  constructor(
    readonly kind: JiraErrorKind,
    detail?: string,
    readonly status?: number,
  ) {
    super(detail ? `${MESSAGES[kind]} ${detail}` : MESSAGES[kind]);
    this.name = "JiraError";
  }
}
