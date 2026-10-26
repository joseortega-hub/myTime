"use client";
import { CheckCircle2, Download, Globe, PlugZap, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  addHolidayAction,
  deleteBalanceAction,
  deleteHolidayAction,
  importDataAction,
  importHolidaysFileAction,
  importPublicHolidaysAction,
  setYearVerifiedAction,
  syncMyAbsencesAction,
  testJiraConnectionAction,
  updateCalendarAction,
  updateScheduleAction,
  upsertBalanceAction,
} from "@/app/actions";
import { ABSENCE_TYPE_LABEL, type AbsenceType } from "@/domain/absences";
import { BALANCE_SOURCE_LABEL, type BalanceSource } from "@/domain/balance";
import { HOLIDAY_SCOPE_LABEL, type HolidayScope } from "@/domain/calendar";
import { formatDate, WEEKDAY_NAMES } from "@/domain/dates";
import { formatMinutes, isValidTime, scheduledMinutes, type ScheduleDay } from "@/domain/hours/schedule";
import type { JiraPublicStatus } from "@/integrations/jira/config";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, Select, buttonClass, cx, formatDays } from "./ui";
import { PushSection } from "./push-section";
import { useAction, useConfirm } from "./ui-client";
import { logoutAction } from "@/app/acceso/actions";

interface Props {
  year: number;
  currentYear: number;
  calendar: { name: string; country: string | null; region: string | null; municipality: string | null; workingWeekdays: number[]; verifiedYears: number[] };
  holidays: { id: string; date: string; name: string; scope: HolidayScope; source: string }[];
  regions: { code: string; name: string; provinces: string[] }[];
  balances: { year: number; absenceType: AbsenceType; allocatedDays: number; carryOverDays: number; source: BalanceSource; notes: string | null }[];
  schedule: ScheduleDay[];
  jira: JiraPublicStatus;
  push: { publicKey: string | null; subscriptions: Parameters<typeof PushSection>[0]["subscriptions"] };
  authEnabled: boolean;
  runs: { id: string; kind: string; mode: string; status: string; created: number; updated: number; removed: number; unchanged: number; errorMessage: string | null; startedAt: string }[];
}

const SECTIONS = [
  { id: "calendario", label: "Calendario laboral" },
  { id: "saldos", label: "Saldos" },
  { id: "jornada", label: "Jornada" },
  { id: "avisos", label: "Avisos al móvil" },
  { id: "jira", label: "Jira" },
  { id: "datos", label: "Datos y copias" },
];

export function SettingsView(p: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Secciones de ajustes" className="lg:sticky lg:top-8 lg:h-fit">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((s) => (
            <li key={s.id}><a href={`#${s.id}`} className="block rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-soft hover:bg-hover hover:text-ink">{s.label}</a></li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-6">
        <CalendarSection {...p} />
        <BalancesSection {...p} />
        <ScheduleSection schedule={p.schedule} />
        <PushSection publicKey={p.push.publicKey} subscriptions={p.push.subscriptions} />
        <JiraSection jira={p.jira} runs={p.runs} year={p.year} />
        <DataSection />
        {p.authEnabled && (
          <form action={logoutAction} className="flex justify-end">
            <Button type="submit" variant="secondary">Cerrar sesión</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function CalendarSection({ year, currentYear, calendar, holidays, regions }: Props) {
  const router = useRouter();
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [cal, setCal] = useState(calendar);
  const [h, setH] = useState({ date: "", name: "", scope: "LOCAL" as HolidayScope });
  const file = useRef<HTMLInputElement>(null);
  const verified = calendar.verifiedYears.includes(year);
  const regionMatch = regions.find((r) => [r.code, r.name, ...r.provinces].some((x) => x.toLowerCase() === (cal.region ?? "").trim().toLowerCase()));

  return (
    <Card id="calendario" className="scroll-mt-6">
      <CardHeader title="Calendario laboral" description="Dónde trabajas y qué días son laborables. No se presupone lunes a viernes." />
      <form
        className="grid gap-4 border-b border-line p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateCalendarAction(cal), { success: "Calendario guardado." });
        }}
      >
        <Field label="Nombre" htmlFor="c-name"><Input id="c-name" value={cal.name} onChange={(e) => setCal({ ...cal, name: e.target.value })} /></Field>
        <Field label="País (código de 2 letras)" htmlFor="c-country" hint="ES para España."><Input id="c-country" maxLength={2} value={cal.country ?? ""} onChange={(e) => setCal({ ...cal, country: e.target.value.toUpperCase() })} /></Field>
        <Field
          label="Comunidad autónoma o provincia"
          htmlFor="c-region"
          hint={regionMatch ? `Se usará ${regionMatch.name} (${regionMatch.code}) para los festivos autonómicos.` : "Por ejemplo: Alicante, Comunitat Valenciana…"}
        >
          <Input id="c-region" list="regions" value={cal.region ?? ""} onChange={(e) => setCal({ ...cal, region: e.target.value })} />
          <datalist id="regions">
            {[...new Set(regions.flatMap((r) => [r.name, ...r.provinces]))].map((n) => <option key={n} value={n} />)}
          </datalist>
        </Field>
        <Field label="Municipio" htmlFor="c-mun" hint="Sus festivos locales se añaden a mano o por archivo."><Input id="c-mun" value={cal.municipality ?? ""} onChange={(e) => setCal({ ...cal, municipality: e.target.value })} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Días laborables</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((n, i) => {
              const d = i + 1;
              const on = cal.workingWeekdays.includes(d);
              return (
                <label key={n} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-sm capitalize select-none", on ? "border-primary bg-primary-soft text-primary-strong" : "border-line-strong text-ink-soft")}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => setCal({ ...cal, workingWeekdays: on ? cal.workingWeekdays.filter((x) => x !== d) : [...cal.workingWeekdays, d].sort() })} />
                  {n}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Guardar calendario</Button></div>
      </form>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Festivos de</h3>
            <Select aria-label="Año de los festivos" className="h-9 w-28" value={year} onChange={(e) => router.push(`/ajustes?año=${e.target.value}#calendario`)}>
              {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            {verified ? <Badge tone="success"><CheckCircle2 className="size-3" /> Confirmado</Badge> : <Badge tone="warning">Sin confirmar</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="subtle"
              disabled={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: `Importar festivos oficiales de ${year}`,
                  description: `Se consultará el servicio público Nager.Date enviando solo el país (${calendar.country ?? "—"}) y el año. Se añaden los festivos nacionales y los de tu comunidad; no los locales. Guarda antes el calendario si has cambiado la comunidad.`,
                  confirmLabel: "Importar",
                });
                if (ok) await run(() => importPublicHolidaysAction(year), { success: "Festivos importados. Revísalos antes de confirmar el año." });
              }}
            >
              <Globe className="size-4" /> Importar oficiales
            </Button>
            <Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" /> Importar archivo</Button>
            <input
              ref={file}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              aria-label="Archivo de festivos"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 200_000) return void run(async () => ({ ok: false as const, error: "El archivo es demasiado grande." }));
                const text = await f.text();
                await run(() => importHolidaysFileAction(f.name, text), { success: "Archivo importado." });
              }}
            />
          </div>
        </div>
        <p className="text-xs text-ink-faint">Archivo CSV: <code>fecha;nombre;ámbito</code> (ámbito: nacional, autonómico, local o empresa). JSON: <code>[{"{"}&quot;date&quot;,&quot;name&quot;,&quot;scope&quot;{"}"}]</code>.</p>

        {holidays.length === 0 ? (
          <EmptyState title={`Sin festivos en ${year}`} description="Importa los oficiales de tu comunidad, sube un archivo o añádelos a mano." />
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {holidays.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-32 tabular text-ink-soft">{formatDate(x.date, "weekday")}</span>
                <span className="flex-1 font-medium">{x.name}</span>
                <Badge tone="holiday">{HOLIDAY_SCOPE_LABEL[x.scope]}</Badge>
                <span className="text-xs text-ink-faint">{x.source === "nager.date" ? "Fuente pública" : x.source === "manual" ? "Manual" : "Archivo"}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  aria-label={`Eliminar ${x.name}`}
                  onClick={async () => {
                    const ok = await confirm({ title: `¿Eliminar «${x.name}»?`, description: "El año dejará de estar confirmado.", confirmLabel: "Eliminar", danger: true });
                    if (ok) await run(() => deleteHolidayAction(x.id), { success: "Festivo eliminado." });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="grid gap-3 rounded-xl bg-canvas p-4 sm:grid-cols-[150px_1fr_150px_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => addHolidayAction(h), { success: "Festivo añadido." });
            if (r !== undefined) setH({ date: "", name: "", scope: h.scope });
          }}
        >
          <Field label="Fecha" htmlFor="h-date"><Input id="h-date" type="date" required value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Nombre" htmlFor="h-name"><Input id="h-name" required placeholder="Hogueras de San Juan" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} /></Field>
          <Field label="Ámbito" htmlFor="h-scope">
            <Select id="h-scope" value={h.scope} onChange={(e) => setH({ ...h, scope: e.target.value as HolidayScope })}>
              {(Object.keys(HOLIDAY_SCOPE_LABEL) as HolidayScope[]).map((s) => <option key={s} value={s}>{HOLIDAY_SCOPE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>Añadir</Button>
        </form>

        <Notice tone={verified ? "success" : "warning"}>
          {verified
            ? `Has confirmado que los festivos de ${year} están completos: los cálculos se consideran exactos.`
            : `Cuando hayas revisado los festivos de ${year} (nacionales, autonómicos y locales) con el calendario oficial, márcalos como completos.`}
          <div className="mt-2">
            <Button size="sm" variant={verified ? "secondary" : "primary"} disabled={pending} onClick={() => run(() => setYearVerifiedAction(year, !verified), { success: verified ? "Año marcado como pendiente de revisar." : "Año confirmado." })}>
              {verified ? "Marcar como pendiente" : `Confirmar festivos de ${year}`}
            </Button>
          </div>
        </Notice>
      </div>
    </Card>
  );
}

function BalancesSection({ currentYear, balances }: Props) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [b, setB] = useState({ year: currentYear, absenceType: "VACATION" as "VACATION" | "COMPENSATORY" | "PERSONAL_DAY", allocatedDays: "", carryOverDays: "0", source: "MANUAL" as BalanceSource, notes: "" });
  return (
    <Card id="saldos" className="scroll-mt-6">
      <CardHeader title="Saldos anuales" description="Días asignados por año y tipo. Indica siempre de dónde sale el dato." />
      <form
        className="grid gap-3 border-b border-line p-5 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(
            () => upsertBalanceAction({ ...b, allocatedDays: Number(b.allocatedDays.replace(",", ".")), carryOverDays: Number(b.carryOverDays.replace(",", ".")) || 0, notes: b.notes || null }),
            { success: "Saldo guardado." },
          );
        }}
      >
        <Field label="Año" htmlFor="b-year"><Input id="b-year" type="number" min={2000} max={2100} value={b.year} onChange={(e) => setB({ ...b, year: Number(e.target.value) })} /></Field>
        <Field label="Tipo" htmlFor="b-type">
          <Select id="b-type" value={b.absenceType} onChange={(e) => setB({ ...b, absenceType: e.target.value as typeof b.absenceType })}>
            {(["VACATION", "COMPENSATORY", "PERSONAL_DAY"] as const).map((t) => <option key={t} value={t}>{ABSENCE_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Origen del dato" htmlFor="b-source">
          <Select id="b-source" value={b.source} onChange={(e) => setB({ ...b, source: e.target.value as BalanceSource })}>
            {(Object.keys(BALANCE_SOURCE_LABEL) as BalanceSource[]).map((s) => <option key={s} value={s}>{BALANCE_SOURCE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Días asignados" htmlFor="b-alloc"><Input id="b-alloc" inputMode="decimal" required value={b.allocatedDays} onChange={(e) => setB({ ...b, allocatedDays: e.target.value })} /></Field>
        <Field label="Arrastrados del año anterior" htmlFor="b-carry"><Input id="b-carry" inputMode="decimal" value={b.carryOverDays} onChange={(e) => setB({ ...b, carryOverDays: e.target.value })} /></Field>
        <Field label="Notas" htmlFor="b-notes"><Input id="b-notes" value={b.notes} onChange={(e) => setB({ ...b, notes: e.target.value })} /></Field>
        <div className="sm:col-span-3"><Button type="submit" disabled={pending || !b.allocatedDays}>Guardar saldo</Button></div>
      </form>
      {balances.length === 0 ? (
        <p className="p-5 text-sm text-ink-soft">Aún no hay saldos. Sin ellos, MyTime no calcula los días disponibles.</p>
      ) : (
        <ul className="divide-y divide-line">
          {balances.map((x) => (
            <li key={`${x.year}-${x.absenceType}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="w-12 font-medium tabular">{x.year}</span>
              <span className="flex-1">{ABSENCE_TYPE_LABEL[x.absenceType]}: <span className="font-medium tabular">{formatDays(x.allocatedDays)}</span> días{x.carryOverDays ? ` + ${formatDays(x.carryOverDays)} arrastrados` : ""}</span>
              <Badge tone={x.source === "OFFICIAL" ? "success" : x.source === "ESTIMATED" ? "warning" : "info"}>{BALANCE_SOURCE_LABEL[x.source]}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setB({ year: x.year, absenceType: x.absenceType as typeof b.absenceType, allocatedDays: String(x.allocatedDays), carryOverDays: String(x.carryOverDays), source: x.source, notes: x.notes ?? "" })}>Editar</Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                aria-label="Eliminar saldo"
                onClick={async () => {
                  const ok = await confirm({ title: "¿Eliminar este saldo?", description: `${ABSENCE_TYPE_LABEL[x.absenceType]} ${x.year}. Dejará de calcularse el disponible.`, confirmLabel: "Eliminar", danger: true });
                  if (ok) await run(() => deleteBalanceAction(x.year, x.absenceType), { success: "Saldo eliminado." });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScheduleSection({ schedule }: { schedule: ScheduleDay[] }) {
  const { run, pending } = useAction();
  const [days, setDays] = useState(() =>
    WEEKDAY_NAMES.map((_, i) => {
      const d = schedule.find((s) => s.weekday === i + 1);
      return { weekday: i + 1, enabled: Boolean(d), startTime: d?.startTime ?? "08:00", endTime: d?.endTime ?? "15:00", breakMinutes: d?.breakMinutes ?? 0 };
    }),
  );
  const set = (i: number, patch: Partial<(typeof days)[number]>) => setDays((l) => l.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const total = days.filter((d) => d.enabled && isValidTime(d.startTime) && isValidTime(d.endTime) && d.startTime < d.endTime).reduce((s, d) => s + scheduledMinutes(d), 0);
  return (
    <Card id="jornada" className="scroll-mt-6">
      <CardHeader title="Jornada laboral" description={`Horas esperadas por día para el módulo de horas · ${formatMinutes(total)} a la semana.`} />
      <form
        className="space-y-2 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateScheduleAction(days.filter((d) => d.enabled).map((d) => ({ weekday: d.weekday, startTime: d.startTime, endTime: d.endTime, breakMinutes: d.breakMinutes }))), { success: "Jornada guardada." });
        }}
      >
        {days.map((d, i) => (
          <div key={d.weekday} className="grid grid-cols-[110px_1fr_1fr_90px] items-center gap-2 text-sm sm:grid-cols-[140px_130px_130px_110px_1fr]">
            <label className="flex items-center gap-2 capitalize">
              <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={d.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
              {WEEKDAY_NAMES[i]}
            </label>
            <Input aria-label={`Entrada ${WEEKDAY_NAMES[i]}`} type="time" disabled={!d.enabled} value={d.startTime} onChange={(e) => set(i, { startTime: e.target.value })} />
            <Input aria-label={`Salida ${WEEKDAY_NAMES[i]}`} type="time" disabled={!d.enabled} value={d.endTime} onChange={(e) => set(i, { endTime: e.target.value })} />
            <Input aria-label={`Pausa en minutos ${WEEKDAY_NAMES[i]}`} type="number" min={0} max={480} disabled={!d.enabled} value={d.breakMinutes} onChange={(e) => set(i, { breakMinutes: Number(e.target.value) })} />
            <span className="hidden text-ink-soft tabular sm:block">{d.enabled && d.startTime < d.endTime ? formatMinutes(scheduledMinutes(d)) : "—"}</span>
          </div>
        ))}
        <p className="pt-1 text-xs text-ink-faint">Columnas: entrada, salida y pausa (minutos que no se trabajan, p. ej. la comida).</p>
        <Button type="submit" disabled={pending}>Guardar jornada</Button>
      </form>
    </Card>
  );
}

function JiraSection({ jira, runs, year }: { jira: JiraPublicStatus; runs: Props["runs"]; year: number }) {
  const { run, pending } = useAction();
  const [conn, setConn] = useState<string | null>(null);
  const modeLabel = { disabled: "Desactivada", mock: "Simulada (sin red)", live: "Real · solo lectura" }[jira.mode];
  return (
    <Card id="jira" className="scroll-mt-6">
      <CardHeader title="Integración con Jira" description="Se configura en el servidor con variables de entorno. Nunca se piden ni guardan contraseñas." action={<Badge tone={jira.mode === "live" ? "success" : jira.mode === "mock" ? "warning" : "neutral"}>{modeLabel}</Badge>} />
      <div className="space-y-4 p-5 text-sm">
        <dl className="grid grid-cols-[180px_1fr] gap-y-1.5">
          <dt className="text-ink-soft">Instancia</dt><dd>{jira.baseUrlHost ?? "—"}</dd>
          <dt className="text-ink-soft">Autenticación</dt><dd>{jira.authMethod === "pat" ? "Token personal (PAT)" : "OAuth 2.0"} · {jira.tokenConfigured ? "token configurado en el servidor" : "sin token"}</dd>
          <dt className="text-ink-soft">Mapeo de campos</dt><dd>{jira.mode !== "live" ? "No necesario" : jira.mappingLoaded ? "Cargado" : "Pendiente"}</dd>
          <dt className="text-ink-soft">Imputar horas</dt><dd>{jira.writeEnabled ? "Habilitado" : "Deshabilitado (solo lectura)"}</dd>
        </dl>
        {jira.problems.length > 0 && <Notice tone="warning"><ul className="list-disc pl-4">{jira.problems.map((x) => <li key={x}>{x}</li>)}</ul></Notice>}
        {jira.mode === "disabled" && <Notice tone="info">MyTime funciona completo sin Jira. Para activar la conexión, consulta <code>docs/JIRA_INTEGRATION.md</code>: hace falta autorización de la empresa.</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending || jira.mode === "disabled"} onClick={async () => { const r = await run(() => testJiraConnectionAction(), { refresh: false }); if (r) setConn(r.message); }}>
            <PlugZap className="size-4" /> Probar conexión
          </Button>
          <Button disabled={pending || jira.mode === "disabled"} onClick={() => run(() => syncMyAbsencesAction(year), { success: "Sincronización terminada." })}>
            <RefreshCw className="size-4" /> Leer mis ausencias de {year}
          </Button>
        </div>
        {conn && <p className="text-ink-soft">{conn}</p>}
        {runs.length > 0 && (
          <div>
            <h3 className="mb-2 font-medium">Últimas sincronizaciones</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                  <span className="w-36 text-ink-soft">{new Date(r.startedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span>{r.kind === "absences" ? "Ausencias" : "Horas"} · {r.mode === "mock" ? "simulado" : r.mode}</span>
                  <Badge tone={r.status === "SUCCESS" ? "success" : r.status === "PARTIAL" ? "warning" : r.status === "RUNNING" ? "info" : "danger"}>{r.status}</Badge>
                  <span className="text-ink-soft">+{r.created} · ~{r.updated} · −{r.removed} · ={r.unchanged}</span>
                  {r.errorMessage && <span className="w-full text-danger">{r.errorMessage}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function DataSection() {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  return (
    <Card id="datos" className="scroll-mt-6">
      <CardHeader title="Datos y copias de seguridad" description="Tus datos están en la base de datos local. Exporta copias periódicamente." />
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <a href="/api/export?format=json" className={buttonClass("primary")}><Download className="size-4" /> Copia completa (JSON)</a>
          <a href="/api/export?format=absences-csv" className={buttonClass("secondary")}><Download className="size-4" /> Ausencias (CSV)</a>
          <a href="/api/export?format=hours-csv" className={buttonClass("secondary")}><Download className="size-4" /> Horas (CSV)</a>
        </div>
        <div>
          <Button variant="secondary" disabled={pending} onClick={() => file.current?.click()}><Upload className="size-4" /> Importar copia (JSON)</Button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Archivo de copia de seguridad"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const ok = await confirm({
                title: "¿Importar esta copia?",
                description: `${f.name}. Se valida todo el archivo antes de escribir; los registros que ya existen se omiten. Los saldos del archivo sustituyen a los actuales del mismo año y tipo.`,
                confirmLabel: "Importar",
              });
              if (ok) await run(async () => importDataAction(await f.text()), { success: "Copia importada." });
            }}
          />
        </div>
        <Notice tone="info" title="No hay copias automáticas">
          La exportación es manual. Para copias de la base de datos completa usa <code>pg_dump</code> (instrucciones en el README).
        </Notice>
      </div>
    </Card>
  );
}
