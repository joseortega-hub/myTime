import "server-only";
/**
 * Notificaciones push al móvil u ordenador (Web Push + VAPID, gratuito).
 *
 * - El navegador del dispositivo se suscribe y la suscripción se guarda aquí.
 * - Un programador externo (cron) llama a /api/cron/reminders cada día; se
 *   envían los recordatorios pendientes y se anotan para no repetirlos.
 * - Sin claves VAPID configuradas no se envía nada.
 */
import webpush from "web-push";
import { z } from "zod";
import { pendingPushes, type AppAlert } from "@/domain/alerts";
import { UserFacingError, WithWarnings } from "@/lib/result";
import { today } from "../context";
import { db } from "../db";
import { computeAlerts } from "./planning";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getPushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/** Solo la clave pública (segura para el navegador). */
export function publicPushKey(): string | null {
  return getPushConfig()?.publicKey ?? null;
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "El endpoint debe ser https."),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().trim().max(60).nullable().optional(),
});

export async function saveSubscription(raw: unknown) {
  const s = subscriptionSchema.parse(raw);
  await db.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    update: { p256dh: s.keys.p256dh, auth: s.keys.auth, label: s.label ?? null, failures: 0 },
    create: { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, label: s.label ?? null },
  });
}

export async function deleteSubscription(endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint } });
}

export async function listSubscriptions() {
  const rows = await db.pushSubscription.findMany({ orderBy: { createdAt: "desc" } });
  // No se exponen las claves de cifrado de la suscripción.
  return rows.map((r) => ({ id: r.id, endpoint: r.endpoint, label: r.label, failures: r.failures, lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

function defaultSender(cfg: PushConfig): PushSender {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return async (sub, payload) => {
    await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 });
  };
}

/** Envía a todos los dispositivos. Elimina suscripciones caducadas (404/410). */
export async function sendToAll(payload: PushPayload, sender?: PushSender) {
  const cfg = getPushConfig();
  if (!cfg && !sender) throw new UserFacingError("Las notificaciones push no están configuradas en el servidor (faltan las claves VAPID).");
  const send = sender ?? defaultSender(cfg!);
  const subs = await db.pushSubscription.findMany();
  let delivered = 0;
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      delivered++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || s.failures >= 4) await db.pushSubscription.delete({ where: { id: s.id } });
      else await db.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } });
    }
  }
  return { devices: subs.length, delivered };
}

export async function sendTestNotification() {
  const r = await sendToAll({ title: "MyTime", body: "Notificación de prueba: los avisos llegarán a este dispositivo.", url: "/alertas", tag: "test" });
  if (r.devices === 0) throw new UserFacingError("No hay ningún dispositivo suscrito. Activa los avisos primero.");
  return new WithWarnings(r, r.delivered === 0 ? ["No se ha podido entregar a ningún dispositivo."] : []);
}

function toPayload(a: AppAlert): PushPayload {
  return { title: a.title, body: a.description, url: a.href, tag: a.kind };
}

/**
 * Ejecución diaria del programador: calcula los recordatorios de hoy y envía
 * los que aún no se han enviado. Idempotente: puede ejecutarse varias veces.
 */
export async function runReminders(opts: { date?: string; sender?: PushSender } = {}) {
  const date = opts.date ?? today();
  const alerts = await computeAlerts(date);
  const sentKeys = new Set((await db.notificationLog.findMany({ where: { key: { in: alerts.map((a) => a.key) } }, select: { key: true } })).map((l) => l.key));
  const due = pendingPushes(alerts, sentKeys);
  const results: { key: string; title: string; delivered: number }[] = [];
  const configured = Boolean(opts.sender || getPushConfig());
  const devices = await db.pushSubscription.count();
  // Sin claves o sin dispositivos no se envía ni se marca nada: se enviará cuando estén listos.
  if (!configured || devices === 0) return { date, due: due.length, results, configured, devices };
  for (const a of due) {
    const r = await sendToAll(toPayload(a), opts.sender);
    // Solo se marca como enviado si llegó a algún dispositivo; si no, se reintenta en la próxima ejecución.
    if (r.delivered > 0) {
      await db.notificationLog.create({ data: { key: a.key, title: a.title.slice(0, 200), sent: r.delivered } });
    }
    results.push({ key: a.key, title: a.title, delivered: r.delivered });
  }
  return { date, due: due.length, results, configured, devices };
}
