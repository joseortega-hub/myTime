"use client";
import { BellRing, Send, Smartphone, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/app/actions";
import { Badge, Button, Card, CardHeader, Notice } from "./ui";
import { useAction, useConfirm } from "./ui-client";

interface Sub { id: string; endpoint: string; label: string | null; failures: number; lastSuccessAt: string | null; createdAt: string }

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const noop = () => () => {};
const supportedSnapshot = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "Navegador";
}

export function PushSection({ publicKey, subscriptions }: { publicKey: string | null; subscriptions: Sub[] }) {
  const supported = useSyncExternalStore(noop, supportedSnapshot, () => false);
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    if (!publicKey) return;
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("No has dado permiso para mostrar notificaciones en este dispositivo.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const json = sub.toJSON();
      await run(() => savePushSubscriptionAction({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }), { success: "Avisos activados en este dispositivo." });
    } catch {
      setError("No se ha podido activar. En iPhone, primero añade MyTime a la pantalla de inicio y ábrela desde allí.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="avisos" className="scroll-mt-6">
      <CardHeader
        title="Avisos en el móvil"
        description="Recordatorios de cierre semanal de Jira (jueves y viernes), festivos, compensados y guardias (una semana y un día antes) y plazos de vacaciones."
        action={<Badge tone={publicKey ? "success" : "neutral"}>{publicKey ? "Servidor preparado" : "Sin configurar"}</Badge>}
      />
      <div className="space-y-4 p-5 text-sm">
        {!publicKey && (
          <Notice tone="info" title="Falta configurar el servidor">
            Define <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> y <code>CRON_SECRET</code> (genera las claves con <code>npm run push:keys</code>) y programa una llamada diaria a <code>/api/cron/reminders</code>. Instrucciones en el README.
          </Notice>
        )}
        {publicKey && !supported && <Notice tone="warning">Este navegador no admite notificaciones push. En iPhone, añade MyTime a la pantalla de inicio (iOS 16.4 o superior) y ábrela desde allí.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!publicKey || !supported || busy || pending} onClick={enable}><BellRing className="size-4" /> Activar en este dispositivo</Button>
          <Button variant="secondary" disabled={!publicKey || subscriptions.length === 0 || pending} onClick={() => run(() => sendTestPushAction(), { success: "Notificación de prueba enviada.", refresh: false })}>
            <Send className="size-4" /> Enviar prueba
          </Button>
        </div>
        {subscriptions.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Smartphone className="size-4 text-ink-soft" aria-hidden />
                <span className="flex-1">{s.label ?? "Dispositivo"} <span className="text-xs text-ink-faint">· desde {new Date(s.createdAt).toLocaleDateString("es-ES")}</span></span>
                {s.lastSuccessAt && <span className="text-xs text-ink-faint">último aviso {new Date(s.lastSuccessAt).toLocaleDateString("es-ES")}</span>}
                {s.failures > 0 && <Badge tone="warning">{s.failures} fallos</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  aria-label="Quitar dispositivo"
                  onClick={async () => {
                    const ok = await confirm({ title: "¿Dejar de enviar avisos a este dispositivo?", confirmLabel: "Quitar", danger: true });
                    if (ok) await run(() => deletePushSubscriptionAction(s.endpoint), { success: "Dispositivo quitado." });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-faint">
          Los avisos solo llegan con la app desplegada en un servidor con HTTPS y un programador diario configurado. En local puedes probarlos en este ordenador.
        </p>
      </div>
    </Card>
  );
}
