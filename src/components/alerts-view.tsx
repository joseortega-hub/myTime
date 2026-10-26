"use client";
import { AlertOctagon, AlertTriangle, BellOff, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dismissAlertAction, saveAlertRulesAction } from "@/app/actions";
import type { AlertRules, AppAlert } from "@/domain/alerts";
import { MONTH_NAMES } from "@/domain/dates";
import { Button, Card, CardHeader, EmptyState, Field, Input, Notice, Select, cx } from "./ui";
import { useAction } from "./ui-client";

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info };
const TONE = { critical: "text-danger bg-danger-soft", warning: "text-pending bg-pending-soft", info: "text-info bg-info-soft" };

export function AlertsView({ alerts, rules }: { alerts: (AppAlert & { dismissed: boolean })[]; rules: AlertRules }) {
  const { run, pending } = useAction();
  const active = alerts.filter((a) => !a.dismissed);
  const dismissed = alerts.filter((a) => a.dismissed);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Activas (${active.length})`} />
          {active.length === 0 ? (
            <EmptyState icon={<BellOff className="size-5" />} title="Todo en orden" description="No hay avisos con las reglas actuales." />
          ) : (
            <ul className="divide-y divide-line">
              {active.map((a) => {
                const Icon = ICON[a.severity];
                return (
                  <li key={a.key} className="flex items-start gap-3 px-5 py-4">
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", TONE[a.severity])}><Icon className="size-4" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <Link href={a.href} className="inline-flex items-center text-sm font-medium hover:text-primary hover:underline touch:min-h-11">{a.title}</Link>
                      <p className="text-sm text-ink-soft">{a.description}</p>
                    </div>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissAlertAction(a.key, true))}>Descartar</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {dismissed.length > 0 && (
          <Card>
            <CardHeader title={`Descartadas (${dismissed.length})`} />
            <ul className="divide-y divide-line">
              {dismissed.map((a) => (
                <li key={a.key} className="flex items-center gap-3 px-5 py-3 text-sm text-ink-soft">
                  <span className="flex-1">{a.title}</span>
                  <Button size="sm" variant="ghost" onClick={() => run(() => dismissAlertAction(a.key, false))}><RotateCcw className="size-3.5" /> Restaurar</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <RulesForm rules={rules} />
    </div>
  );
}

function RulesForm({ rules }: { rules: AlertRules }) {
  const [r, setR] = useState(rules);
  const [offsets, setOffsets] = useState(rules.reminderOffsets.join(", "));
  const { run, pending } = useAction();
  const num = (k: keyof AlertRules) => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...r, [k]: Number(e.target.value) });
  return (
    <Card className="h-fit">
      <CardHeader title="Reglas" description="Ajusta cuándo quieres que te avise." />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveAlertRulesAction(r), { success: "Reglas guardadas." });
        }}
      >
        <Field label="Próximas ausencias (días antes)" htmlFor="r-abs"><Input id="r-abs" type="number" min={0} max={90} value={r.upcomingAbsenceDays} onChange={num("upcomingAbsenceDays")} /></Field>
        <Field label="Recordatorios de festivos, compensados y guardias" htmlFor="r-offsets" hint="Días antes, separados por comas. Por defecto: 7, 1 (una semana y un día antes).">
          <Input id="r-offsets" value={offsets} onChange={(e) => { setOffsets(e.target.value); setR({ ...r, reminderOffsets: [...new Set(e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0))] }); }} />
        </Field>
        <Field label="Antelación para pedir vacaciones (meses)" htmlFor="r-lead"><Input id="r-lead" type="number" min={0} max={12} value={r.vacationLeadMonths} onChange={num("vacationLeadMonths")} /></Field>
        <Field label="Solicitudes pendientes (días antes del inicio)" htmlFor="r-pend"><Input id="r-pend" type="number" min={0} max={90} value={r.pendingRequestDays} onChange={num("pendingRequestDays")} /></Field>
        <Field label="Avisar de días sin planificar a partir de" htmlFor="r-month">
          <Select id="r-month" value={r.yearEndFromMonth} onChange={(e) => setR({ ...r, yearEndFromMonth: Number(e.target.value) })}>
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={r.teamOverlap} onChange={(e) => setR({ ...r, teamOverlap: e.target.checked })} /> Coincidencias del equipo</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={r.missingHours} onChange={(e) => setR({ ...r, missingHours: e.target.checked })} /> Días laborables sin horas</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={r.weeklyJiraClose} onChange={(e) => setR({ ...r, weeklyJiraClose: e.target.checked })} /> Cierre semanal de Jira (jueves y viernes)</label>
        <Button type="submit" className="w-full" disabled={pending}>Guardar reglas</Button>
        <Notice tone="info">En la app las alertas se calculan al abrirla. Los recordatorios marcados se envían también al móvil si activas las notificaciones en Ajustes y hay un programador configurado en el servidor (ver README).</Notice>
      </form>
    </Card>
  );
}
