import "server-only";
/**
 * Configuración de la integración leída de variables de entorno del servidor.
 * El token nunca sale de este módulo salvo hacia el cliente HTTP.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { jiraMappingSchema, type JiraMapping } from "./mapping";
import { JiraError, type JiraMode } from "./types";

export interface JiraConfig {
  mode: JiraMode;
  baseUrl: string | null;
  authMethod: "pat" | "oauth2_bearer";
  token: string | null;
  writeEnabled: boolean;
  timeoutMs: number;
  mappingFile: string;
}

/** Información segura para mostrar en la interfaz (sin secretos). */
export interface JiraPublicStatus {
  mode: JiraMode;
  baseUrlHost: string | null;
  authMethod: string;
  tokenConfigured: boolean;
  writeEnabled: boolean;
  mappingLoaded: boolean;
  problems: string[];
}

export function loadJiraConfig(env: Record<string, string | undefined> = process.env): JiraConfig {
  const rawMode = (env.JIRA_MODE ?? "disabled").trim().toLowerCase();
  const mode: JiraMode = rawMode === "mock" || rawMode === "live" ? rawMode : "disabled";
  const baseUrl = env.JIRA_BASE_URL?.trim().replace(/\/+$/, "") || null;
  return {
    mode,
    baseUrl,
    authMethod: env.JIRA_AUTH_METHOD === "oauth2_bearer" ? "oauth2_bearer" : "pat",
    token: env.JIRA_TOKEN?.trim() || null,
    writeEnabled: env.JIRA_ENABLE_WORKLOG_WRITE === "true",
    timeoutMs: Math.min(Math.max(Number(env.JIRA_TIMEOUT_MS) || 15_000, 1_000), 60_000),
    mappingFile: env.JIRA_MAPPING_FILE?.trim() || "config/jira-mapping.json",
  };
}

export function validateLiveConfig(cfg: JiraConfig): string[] {
  const problems: string[] = [];
  if (!cfg.baseUrl) problems.push("Falta JIRA_BASE_URL.");
  else {
    try {
      const u = new URL(cfg.baseUrl);
      if (u.protocol !== "https:") problems.push("JIRA_BASE_URL debe usar https.");
    } catch {
      problems.push("JIRA_BASE_URL no es una URL válida.");
    }
  }
  if (!cfg.token) problems.push("Falta JIRA_TOKEN (emitido por un mecanismo autorizado por la empresa).");
  return problems;
}

export function loadMapping(cfg: JiraConfig, cwd = process.cwd()): JiraMapping {
  const file = path.resolve(/*turbopackIgnore: true*/ cwd, cfg.mappingFile);
  if (!file.startsWith(path.resolve(/*turbopackIgnore: true*/ cwd))) throw new JiraError("mapping", "La ruta del archivo de mapeo debe estar dentro del proyecto.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
  } catch {
    throw new JiraError("mapping", `No se puede leer ${cfg.mappingFile}. Copia config/jira-mapping.example.json y complétalo.`);
  }
  const parsed = jiraMappingSchema.safeParse(raw);
  if (!parsed.success) throw new JiraError("mapping", parsed.error.issues[0]?.message);
  return parsed.data;
}

export function publicStatus(cfg: JiraConfig = loadJiraConfig()): JiraPublicStatus {
  const problems: string[] = [];
  let mappingLoaded = false;
  if (cfg.mode === "live") {
    problems.push(...validateLiveConfig(cfg));
    try {
      loadMapping(cfg);
      mappingLoaded = true;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : "Mapeo no válido.");
    }
  }
  let host: string | null = null;
  try {
    host = cfg.baseUrl ? new URL(cfg.baseUrl).host : null;
  } catch {
    host = null;
  }
  return {
    mode: cfg.mode,
    baseUrlHost: host,
    authMethod: cfg.authMethod,
    tokenConfigured: Boolean(cfg.token),
    writeEnabled: cfg.writeEnabled,
    mappingLoaded,
    problems,
  };
}
