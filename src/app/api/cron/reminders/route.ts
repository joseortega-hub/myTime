import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

/**
 * Lo llama un programador externo una vez al día (p. ej. a las 9:00 de lunes a
 * viernes). Requiere `Authorization: Bearer <CRON_SECRET>`.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) return new Response("No autorizado", { status: 401 });
  try {
    const result = await runReminders();
    return Response.json({ ok: true, date: result.date, pending: result.due, sent: result.results.filter((r) => r.delivered > 0).length, pushConfigured: result.configured, devices: result.devices });
  } catch {
    return Response.json({ ok: false, error: "No se han podido procesar los recordatorios." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
