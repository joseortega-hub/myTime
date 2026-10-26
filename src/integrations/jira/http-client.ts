import "server-only";
/**
 * Cliente HTTP mínimo para la API REST de Jira.
 * - Solo GET, salvo `postWorklog` (que exige escritura habilitada).
 * - Errores clasificados y saneados: nunca incluyen el token ni el cuerpo.
 * - No reutiliza cookies del navegador ni automatiza inicios de sesión.
 */
import { JiraError } from "./types";

export interface JiraHttpOptions {
  baseUrl: string;
  token: string;
  authMethod: "pat" | "oauth2_bearer";
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class JiraHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: JiraHttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): HeadersInit {
    // PAT de Jira Data Center y tokens OAuth 2.0 usan ambos el esquema Bearer.
    return { Authorization: `Bearer ${this.opts.token}`, Accept: "application/json", ...extra };
  }

  async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, query?: Record<string, string | number>, body?: unknown): Promise<T> {
    if (!path.startsWith("/rest/")) throw new JiraError("invalid_response", "Ruta de API no permitida.");
    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(body ? { "Content-Type": "application/json" } : undefined),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        redirect: "error", // una redirección suele indicar una página de inicio de sesión SSO
        cache: "no-store",
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new JiraError("timeout");
      throw new JiraError("network");
    }

    if (res.status === 401) throw new JiraError("auth", undefined, 401);
    if (res.status === 403) throw new JiraError("forbidden", undefined, 403);
    if (res.status === 404) throw new JiraError("not_found", undefined, 404);
    if (res.status === 429) throw new JiraError("rate_limited", undefined, 429);
    if (res.status >= 500) throw new JiraError("server", `(HTTP ${res.status})`, res.status);
    if (!res.ok) throw new JiraError("invalid_response", `(HTTP ${res.status})`, res.status);

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      // Las páginas HTML suelen ser el portal de inicio de sesión: no se interpretan.
      throw new JiraError("auth", "La respuesta no es JSON (¿redirección al inicio de sesión corporativo?).");
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new JiraError("invalid_response");
    }
  }
}
