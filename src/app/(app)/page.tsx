import { ArrowRight, CalendarHeart, Plane, Sparkles } from "lucide-react";
import Link from "next/link";
import { STATUS_TONE } from "@/components/absence-style";
import { NewAbsenceButton } from "@/components/new-absence-button";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, SegmentedLinks, Stat, TEXT_LINK, formatDays } from "@/components/ui";
import { ABSENCE_STATUS_LABEL, ABSENCE_TYPE_LABEL, ACTIVE_STATUSES, computeConsumption } from "@/domain/absences";
import { BALANCE_SOURCE_LABEL, type BalanceSummary } from "@/domain/balance";
import { calendarCompleteness, summarizePeriod } from "@/domain/calendar";
import { diffDays, endOfMonth, formatDate, formatRange, MONTH_NAMES, monthOf, startOfMonth, yearOf } from "@/domain/dates";
import { getCalendarContext, today } from "@/server/context";
import { getBalances, listAbsences } from "@/server/services/absences";
import { getAlerts } from "@/server/services/planning";

export const dynamic = "force-dynamic";

function parseYear(v: string | string[] | undefined, fallback: number) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const now = today();
  const currentYear = yearOf(now);
  const year = parseYear(sp["año"], currentYear);
  const { rules, index } = await getCalendarContext();
  const [balances, absences, alerts] = await Promise.all([getBalances(year), listAbsences(), getAlerts()]);
  const vacation = balances.find((b) => b.type === "VACATION")!;
  const completeness = calendarCompleteness(rules, year);

  const nextHoliday = rules.holidays.find((h) => h.date >= now);
  const upcoming = absences
    .filter((a) => a.endDate >= now && ACTIVE_STATUSES.has(a.status))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .slice(0, 4);
  const pending = absences.filter((a) => a.status === "REQUESTED");

  const m = monthOf(now);
  const monthStart = startOfMonth(currentYear, m);
  const monthEnd = endOfMonth(currentYear, m);
  const month = summarizePeriod(monthStart, monthEnd, rules);
  const myMonthDays = absences
    .filter((a) => (a.status === "APPROVED" || a.status === "TAKEN") && a.startDate <= monthEnd && a.endDate >= monthStart)
    .reduce((s, a) => s + computeConsumption({ ...a, startDate: a.startDate < monthStart ? monthStart : a.startDate, endDate: a.endDate > monthEnd ? monthEnd : a.endDate, daysOverride: null }, index).total, 0);
  const remainingWorking = index.countWorkingDays(now, monthEnd);

  return (
    <>
      <PageHeader
        title="Tu situación"
        description={`Resumen calculado con los datos guardados en MyTime · hoy es ${formatDate(now, "long")}.`}
        actions={
          <>
            <SegmentedLinks
              label="Año"
              items={[currentYear - 1, currentYear, currentYear + 1].map((y) => ({ href: `/?año=${y}`, label: String(y), active: y === year }))}
            />
            <NewAbsenceButton rules={rules} defaultDate={now} />
          </>
        }
      />

      {!completeness.complete && (
        <Notice tone="warning" title={`Calendario de ${year} incompleto`} className="mb-6">
          {completeness.reasons.join(" ")}{" "}
          <Link href="/ajustes#calendario" className="font-medium underline">Configurar festivos</Link>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <BalanceCard balance={vacation} year={year} />

        <Card className="flex flex-col">
          <CardHeader title="Optimizador" description="Encuentra las fechas que más descanso te dan." />
          <div className="flex flex-1 flex-col justify-between gap-4 p-5">
            <p className="text-sm text-ink-soft">
              {vacation.available != null
                ? `Tienes ${formatDays(Math.max(0, vacation.available - vacation.requested - vacation.planned))} días sin solicitar ni planificar en ${year}.`
                : "Configura tu saldo para que el optimizador sepa cuántos días puedes repartir."}
            </p>
            <LinkButton href={`/optimizador?año=${year}`} variant="primary" className="w-full">
              <Sparkles className="size-4" aria-hidden /> Buscar mejores fechas
            </LinkButton>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Próximo festivo" />
          <div className="p-5">
            {nextHoliday ? (
              <div className="flex items-center gap-4">
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-holiday-soft text-center text-holiday">
                  <div>
                    <p className="text-lg leading-none font-semibold tabular">{nextHoliday.date.slice(8)}</p>
                    <p className="text-[10px] font-medium uppercase">{MONTH_NAMES[monthOf(nextHoliday.date) - 1].slice(0, 3)}</p>
                  </div>
                </div>
                <div>
                  <p className="font-medium">{nextHoliday.name}</p>
                  <p className="text-sm text-ink-soft">
                    {formatDate(nextHoliday.date, "long")} · {diffDays(now, nextHoliday.date) === 0 ? "hoy" : `en ${diffDays(now, nextHoliday.date)} días`}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState icon={<CalendarHeart className="size-5" />} title="Sin festivos próximos" description="Añade o importa los festivos de tu calendario." action={<LinkButton href="/ajustes#calendario" size="sm">Configurar</LinkButton>} />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Próximas ausencias" action={<Link href="/ausencias" className={TEXT_LINK}>Ver todas</Link>} />
          {upcoming.length === 0 ? (
            <EmptyState icon={<Plane className="size-5" />} title="No tienes ausencias próximas" description="Registra tus vacaciones o usa el optimizador para planificarlas." />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{formatRange(a.startDate, a.endDate)}</p>
                    <p className="text-xs text-ink-soft">
                      {ABSENCE_TYPE_LABEL[a.type]} · {a.startDate <= now ? "en curso" : `empieza en ${diffDays(now, a.startDate)} días`}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]}>{ABSENCE_STATUS_LABEL[a.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`${MONTH_NAMES[m - 1][0].toUpperCase()}${MONTH_NAMES[m - 1].slice(1)} ${currentYear}`} description="Resumen del mes actual" action={<Link href={`/calendario?año=${currentYear}&mes=${m}`} className={TEXT_LINK}>Ver calendario</Link>} />
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Stat label="Días laborables" value={month.workingDays} />
            <Stat label="Quedan este mes" value={remainingWorking} hint="laborables desde hoy" />
            <Stat label="Festivos laborables" value={month.holidaysOnWorkingDays} />
            <Stat label="Tus días de ausencia" value={formatDays(myMonthDays)} hint="aprobados o disfrutados" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Pendiente de tu atención" action={<Link href="/alertas" className={TEXT_LINK}>Alertas</Link>} />
          <div className="space-y-3 p-5 text-sm">
            <p className="flex items-center justify-between">
              <span>Solicitudes pendientes</span>
              <Badge tone={pending.length ? "warning" : "neutral"}>{pending.length}</Badge>
            </p>
            {alerts.filter((a) => a.severity !== "info").slice(0, 3).map((a) => (
              <Link key={a.key} href={a.href} className="flex min-h-11 items-start gap-2 rounded-lg p-2 -mx-2 hover:bg-canvas active:bg-canvas">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.severity === "critical" ? "bg-danger" : "bg-pending"}`} />
                <span>{a.title}</span>
                <ArrowRight className="ml-auto size-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <OtherBalances balances={balances.filter((b) => b.type !== "VACATION")} year={year} />
    </>
  );
}

function BalanceCard({ balance: b, year }: { balance: BalanceSummary; year: number }) {
  const total = b.total ?? 0;
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={`Vacaciones ${year}`}
        description={b.source ? BALANCE_SOURCE_LABEL[b.source] : "Saldo sin configurar"}
        action={
          b.source && (
            <Badge tone={b.source === "OFFICIAL" ? "success" : b.source === "ESTIMATED" ? "warning" : "info"} title="Origen del saldo asignado">
              {b.source === "OFFICIAL" ? "Oficial" : b.source === "ESTIMATED" ? "Estimado" : "Manual"}
            </Badge>
          )
        }
      />
      <div className="p-5">
        {!b.configured ? (
          <EmptyState
            title="Aún no has indicado tus días asignados"
            description="Sin un saldo no se puede calcular cuántos días te quedan. Introdúcelo a mano e indica si es oficial o estimado."
            action={<LinkButton href="/ajustes#saldos" variant="primary">Configurar saldo</LinkButton>}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
              <Stat label="Asignados" value={formatDays(b.total)} hint={b.carryOver ? `incluye ${formatDays(b.carryOver)} arrastrados` : undefined} />
              <Stat label="Disfrutados" value={formatDays(b.enjoyed)} />
              <Stat label="Aprobados por disfrutar" value={formatDays(b.approvedUpcoming)} />
              <Stat label="Pendientes de aprobar" value={formatDays(b.requested)} tone="warning" hint="no descontados" />
              <Stat label="Disponibles" value={formatDays(b.available)} tone="primary" hint={b.exact ? "cálculo exacto" : "cálculo aproximado"} />
            </div>
            <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`Disfrutados ${b.enjoyed}, aprobados ${b.approvedUpcoming}, pendientes ${b.requested}, disponibles ${b.available}`}>
              <div className="bg-taken" style={{ width: `${pct(b.enjoyed)}%` }} />
              <div className="bg-approved" style={{ width: `${pct(b.approvedUpcoming)}%` }} />
              <div className="bg-pending/70" style={{ width: `${pct(b.requested)}%` }} />
              <div className="bg-planned/50" style={{ width: `${pct(b.planned)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
              <Legend className="bg-taken" label="Disfrutados" />
              <Legend className="bg-approved" label="Aprobados" />
              <Legend className="bg-pending/70" label="Pendientes" />
              <Legend className="bg-planned/50" label={`Planificados (${formatDays(b.planned)})`} />
            </div>
            {b.warnings.length > 0 && (
              <Notice tone="warning" className="mt-4">
                <ul className="list-disc space-y-0.5 pl-4">{b.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Notice>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-sm ${className}`} /> {label}
    </span>
  );
}

function OtherBalances({ balances, year }: { balances: BalanceSummary[]; year: number }) {
  const configured = balances.filter((b) => b.configured || b.consumed > 0 || b.requested > 0);
  if (configured.length === 0) return null;
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      {configured.map((b) => (
        <Card key={b.type}>
          <CardHeader title={`${ABSENCE_TYPE_LABEL[b.type]} ${year}`} description={b.source ? BALANCE_SOURCE_LABEL[b.source] : "Sin saldo configurado"} />
          <div className="grid grid-cols-3 gap-4 p-5">
            <Stat label="Asignados" value={formatDays(b.total)} />
            <Stat label="Consumidos" value={formatDays(b.consumed)} />
            <Stat label="Disponibles" value={formatDays(b.available)} tone="primary" />
          </div>
        </Card>
      ))}
    </div>
  );
}
