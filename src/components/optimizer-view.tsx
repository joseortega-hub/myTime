"use client";
import { CalendarRange, Info, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { deletePlanAction, runOptimizerAction, savePlanAction } from "@/app/actions";
import { ABSENCE_STATUS_LABEL, type AbsenceStatus } from "@/domain/absences";
import { formatDate, formatRange } from "@/domain/dates";
import { OBJECTIVE_LABEL, type Block, type OptimizerResult, type PlanAlternative } from "@/domain/optimizer";
import { STATUS_TONE } from "./absence-style";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, Select, cx, formatDays } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";

interface RangeRow {
  start: string;
  end: string;
}
interface ReservedRow extends RangeRow {
  label: string;
  days: number;
}

export function OptimizerView({
  year, today, freeDays, teams, plans,
}: {
  year: number;
  today: string;
  freeDays: number | null;
  teams: { id: string; name: string; isDemo: boolean; size: number }[];
  plans: { id: string; name: string; year: number; createdAt: string; absences: { startDate: string; endDate: string; status: AbsenceStatus }[] }[];
}) {
  const startDefault = today.slice(0, 4) === String(year) ? today : `${year}-01-01`;
  const [range, setRange] = useState<RangeRow>({ start: startDefault, end: `${year}-12-31` });
  const [days, setDays] = useState(String(Math.min(freeDays ?? 5, 10) || 5));
  const [excluded, setExcluded] = useState<RangeRow[]>([]);
  const [priority, setPriority] = useState<RangeRow[]>([]);
  const [reserved, setReserved] = useState<ReservedRow[]>([]);
  const [preferLong, setPreferLong] = useState(false);
  const [avoidTeam, setAvoidTeam] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [result, setResult] = useState<(OptimizerResult & { availableDays: number | null }) | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [saving, setSaving] = useState<PlanAlternative | null>(null);
  const { run, pending } = useAction();

  const calculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompare([]);
    const r = await run(
      () =>
        runOptimizerAction({
          year,
          range,
          daysToSpend: Number(days),
          excluded: excluded.filter((x) => x.start && x.end),
          priority: priority.filter((x) => x.start && x.end),
          reserved: reserved.filter((x) => x.start && x.end),
          preferLongBreaks: preferLong,
          avoidTeamOverlap: avoidTeam,
          teamId: teamId || null,
        }),
      { refresh: false },
    );
    if (r) setResult(r);
  };

  const comparing = result?.alternatives.filter((a) => compare.includes(a.id)) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit lg:sticky lg:top-6">
        <form onSubmit={calculate} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" htmlFor="opt-start"><Input id="opt-start" type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} /></Field>
            <Field label="Hasta" htmlFor="opt-end"><Input id="opt-end" type="date" min={range.start} max={`${year}-12-31`} value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} /></Field>
          </div>
          <Field
            label="Días que quieres gastar"
            htmlFor="opt-days"
            hint={freeDays != null ? `Te quedan ${formatDays(freeDays)} días sin solicitar ni planificar en ${year}.` : "Sin saldo configurado: no se puede comprobar el disponible."}
          >
            <Input id="opt-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>

          <RangeList title="Fechas a excluir" hint="No se propondrán vacaciones en ellas." rows={excluded} setRows={setExcluded} />
          <RangeList title="Fechas prioritarias" hint="Se valoran más las propuestas que las incluyan." rows={priority} setRows={setPriority} />

          <fieldset>
            <legend className="text-sm font-medium">Reservas (Navidad, verano…)</legend>
            <p className="text-xs text-ink-faint">Esos días se apartan del presupuesto y el periodo no se toca.</p>
            <div className="mt-2 space-y-2">
              {reserved.map((r, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-line p-2">
                  <div className="flex gap-2">
                    <Input aria-label="Nombre de la reserva" placeholder="Navidad" value={r.label} onChange={(e) => setReserved((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input aria-label="Días reservados" type="number" min={0} className="w-20" value={r.days} onChange={(e) => setReserved((l) => l.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))} />
                    <Button variant="ghost" aria-label="Quitar reserva" onClick={() => setReserved((l) => l.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input aria-label="Reserva desde" type="date" value={r.start} onChange={(e) => setReserved((l) => l.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                    <Input aria-label="Reserva hasta" type="date" value={r.end} onChange={(e) => setReserved((l) => l.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                  </div>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setReserved((l) => [...l, { label: "Navidad", days: 3, start: `${year}-12-20`, end: `${year}-12-31` }])}>
                <Plus className="size-4" /> Añadir reserva
              </Button>
            </div>
          </fieldset>

          <div className="space-y-2 border-t border-line pt-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={preferLong} onChange={(e) => setPreferLong(e.target.checked)} />
              <span>Prefiero descansos largos <span className="block text-xs text-ink-faint">Valora más pocos periodos largos que muchos puentes.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={avoidTeam} onChange={(e) => setAvoidTeam(e.target.checked)} disabled={teams.length === 0} />
              <span>Evitar coincidir con el equipo <span className="block text-xs text-ink-faint">{teams.length === 0 ? "No hay datos de equipo." : "Descarta días que bajen la cobertura mínima."}</span></span>
            </label>
            {teams.length > 0 && (
              <Field label="Equipo de referencia" htmlFor="opt-team">
                <Select id="opt-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">Ninguno</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDemo ? " (demo)" : ""} · {t.size} personas</option>)}
                </Select>
              </Field>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            <Sparkles className="size-4" aria-hidden /> {pending ? "Calculando…" : "Calcular propuestas"}
          </Button>
        </form>
      </Card>

      <div className="min-w-0 space-y-6">
        {!result ? (
          <Card>
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="Configura tus preferencias y calcula"
              description="El optimizador revisa todos los bloques posibles de días dentro del rango y elige la mejor combinación para cada objetivo."
            />
          </Card>
        ) : (
          <>
            {result.warnings.length > 0 && (
              <Notice tone="warning"><ul className="list-disc space-y-0.5 pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>
            )}
            <p className="flex items-start gap-2 text-xs text-ink-soft">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Búsqueda exhaustiva: {result.stats.candidates.toLocaleString("es-ES")} bloques evaluados con un presupuesto de {result.budget} días. Cada propuesta es la mejor
              combinación posible para su objetivo (días completos; no considera medias jornadas).
            </p>

            {result.alternatives.length === 0 ? (
              <Card><EmptyState title="No hay propuestas" description="Prueba a ampliar el rango, reducir exclusiones o revisar tu saldo." /></Card>
            ) : (
              <div className="space-y-4">
                {result.alternatives.map((a, i) => (
                  <PlanCard
                    key={a.id}
                    plan={a}
                    rank={i + 1}
                    compared={compare.includes(a.id)}
                    onCompare={(on) => setCompare((c) => (on ? [...c, a.id].slice(-3) : c.filter((x) => x !== a.id)))}
                    onSave={() => setSaving(a)}
                    hasTeam={Boolean(teamId)}
                  />
                ))}
              </div>
            )}

            {comparing.length >= 2 && <Comparison plans={comparing} />}

            {result.bridges.length > 0 && (
              <Card>
                <CardHeader title="Mejores puentes sueltos" description="Bloques cortos con mejor relación descanso / día gastado, sin repetir fechas." />
                <ul className="grid gap-2 p-5 sm:grid-cols-2">
                  {result.bridges.map((b) => (
                    <li key={b.restStart} className="rounded-xl border border-line p-3 text-sm">
                      <p className="font-medium">{formatRange(b.restStart, b.restEnd)}</p>
                      <p className="text-xs text-ink-soft">
                        {b.cost} {b.cost === 1 ? "día" : "días"} → {b.restDays} de descanso
                        {b.holidays.length > 0 && ` · ${b.holidays.map((h) => h.name).join(", ")}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        <SavedPlans plans={plans} />
      </div>

      <SavePlanDialog plan={saving} year={year} onClose={() => setSaving(null)} />
    </div>
  );
}

function RangeList({ title, hint, rows, setRows }: { title: string; hint: string; rows: RangeRow[]; setRows: (f: (r: RangeRow[]) => RangeRow[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-ink-faint">{hint}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label={`${title}: desde`} type="date" value={r.start} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, start: e.target.value, end: x.end || e.target.value } : x)))} />
            <Input aria-label={`${title}: hasta`} type="date" min={r.start} value={r.end} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            <Button variant="ghost" aria-label="Quitar" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}><X className="size-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setRows((l) => [...l, { start: "", end: "" }])}><Plus className="size-4" /> Añadir</Button>
      </div>
    </fieldset>
  );
}

function PlanCard({ plan, rank, compared, onCompare, onSave, hasTeam }: { plan: PlanAlternative; rank: number; compared: boolean; onCompare: (on: boolean) => void; onSave: () => void; hasTeam: boolean }) {
  return (
    <Card className={cx(rank === 1 && "ring-2 ring-primary/40")}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("grid size-6 place-items-center rounded-full text-xs font-semibold", rank === 1 ? "bg-primary text-primary-ink" : "bg-canvas text-ink-soft")}>{rank}</span>
            <h3 className="font-semibold">{plan.label}</h3>
            {plan.objectives.slice(1).map((o) => <Badge key={o} tone="primary">También: {OBJECTIVE_LABEL[o].toLowerCase()}</Badge>)}
          </div>
          <p className="mt-1 text-xs text-ink-soft">Puntuación {plan.score.toLocaleString("es-ES")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={compared} onChange={(e) => onCompare(e.target.checked)} /> Comparar
          </label>
          <Button size="sm" onClick={onSave}><Save className="size-4" /> Guardar</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
        <Metric label="Días de vacaciones" value={plan.totalCost} />
        <Metric label="Días de descanso" value={plan.totalRest} highlight />
        <Metric label="Descanso más largo" value={`${plan.longestRest} días`} />
        <Metric label="Rendimiento" value={`×${plan.efficiency.toFixed(2)}`} />
      </div>
      <ul className="space-y-2 px-5 pb-4">
        {plan.blocks.map((b) => <BlockRow key={b.restStart} block={b} hasTeam={hasTeam} />)}
      </ul>
      <div className="border-t border-line bg-canvas/50 px-5 py-3">
        <p className="mb-1 text-xs font-medium text-ink-soft">Por qué se recomienda</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-soft">{plan.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
    </Card>
  );
}

function BlockRow({ block: b, hasTeam }: { block: Block; hasTeam: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-dashed border-planned/40 bg-planned-soft/40 px-3 py-2 text-sm">
      <CalendarRange className="size-4 text-planned" aria-hidden />
      <span className="font-medium">{formatRange(b.restStart, b.restEnd)}</span>
      <span className="text-ink-soft">{b.restDays} días libres</span>
      <span className="text-ink-soft">
        Pedir: {b.vacationDates.length <= 3 ? b.vacationDates.map((d) => formatDate(d, "short")).join(", ") : `${formatDate(b.vacationDates[0], "short")} – ${formatDate(b.vacationDates[b.vacationDates.length - 1], "short")} (${b.cost} días)`}
      </span>
      {b.holidays.length > 0 && <Badge tone="holiday">{b.holidays.length} festivo{b.holidays.length > 1 ? "s" : ""}</Badge>}
      {b.nonWorkingDays > 0 && <Badge>{b.nonWorkingDays} no laborables</Badge>}
      {hasTeam && <Badge tone={b.teamMaxAbsent === 0 ? "success" : "info"}>{b.teamMaxAbsent === 0 ? "Equipo completo" : `Hasta ${b.teamMaxAbsent} ausentes`}</Badge>}
    </li>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={cx("tabular text-lg font-semibold", highlight && "text-primary")}>{value}</p>
    </div>
  );
}

function Comparison({ plans }: { plans: PlanAlternative[] }) {
  const rows: [string, (p: PlanAlternative) => string | number][] = [
    ["Días de vacaciones", (p) => p.totalCost],
    ["Días de descanso", (p) => p.totalRest],
    ["Descanso más largo", (p) => p.longestRest],
    ["Periodos", (p) => p.blocks.length],
    ["Festivos aprovechados", (p) => p.holidays.length],
    ["Días no laborables incluidos", (p) => p.nonWorkingDays],
    ["Máx. compañeros ausentes", (p) => p.teamMaxAbsent],
    ["Puntuación", (p) => p.score],
  ];
  return (
    <Card>
      <CardHeader title="Comparación" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-5 py-2 font-medium text-ink-soft">Métrica</th>
              {plans.map((p) => <th scope="col" key={p.id} className="px-5 py-2 font-medium">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <th scope="row" className="px-5 py-2 text-left font-normal text-ink-soft">{label}</th>
                {plans.map((p) => <td key={p.id} className="px-5 py-2 tabular">{f(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SavePlanDialog({ plan, year, onClose }: { plan: PlanAlternative | null; year: number; onClose: () => void }) {
  const [name, setName] = useState("");
  const { run, pending } = useAction();
  return (
    <Dialog
      open={plan != null}
      onClose={onClose}
      title="Guardar como planificación personal"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={pending}
            onClick={async () => {
              if (!plan) return;
              const r = await run(
                () =>
                  savePlanAction({
                    year,
                    name: name.trim() || plan.label,
                    objective: plan.objective,
                    score: plan.score,
                    blocks: plan.blocks.map((b) => ({ vacationDates: b.vacationDates, restStart: b.restStart, restEnd: b.restEnd, restDays: b.restDays, cost: b.cost })),
                  }),
                { success: "Planificación guardada. Aparece en el calendario como «Planificada»." },
              );
              if (r !== undefined) onClose();
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <Notice tone="info" className="mb-4">Se crearán ausencias en estado «Planificada» solo en MyTime. No se envía ninguna solicitud a Jira ni se descuentan días del saldo.</Notice>
      <Field label="Nombre" htmlFor="plan-name">
        <Input id="plan-name" placeholder={plan?.label} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function SavedPlans({ plans }: { plans: { id: string; name: string; year: number; createdAt: string; absences: { startDate: string; endDate: string; status: AbsenceStatus }[] }[] }) {
  const { run } = useAction();
  const confirm = useConfirm();
  if (plans.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Planificaciones guardadas" description="Pásalas a «Pendiente» desde Ausencias cuando hagas la solicitud real." />
      <ul className="divide-y divide-line">
        {plans.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name} <span className="text-ink-faint">· {p.year}</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.absences.map((a) => (
                  <Badge key={a.startDate} tone={STATUS_TONE[a.status]}>{formatRange(a.startDate, a.endDate)} · {ABSENCE_STATUS_LABEL[a.status]}</Badge>
                ))}
                {p.absences.length === 0 && <span className="text-xs text-ink-faint">Sin ausencias asociadas</span>}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              aria-label={`Eliminar ${p.name}`}
              onClick={async () => {
                const ok = await confirm({ title: "¿Eliminar la planificación?", description: "Se borran sus ausencias que sigan en estado «Planificada». Las que ya pasaste a otro estado se conservan.", confirmLabel: "Eliminar", danger: true });
                if (ok) await run(() => deletePlanAction(p.id), { success: "Planificación eliminada." });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

