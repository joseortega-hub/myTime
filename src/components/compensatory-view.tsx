"use client";
import { Check, Gift, Plus, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  chooseCompensatoryOptionAction,
  createCompensatoryGroupAction,
  deleteCompensatoryGroupAction,
  unchooseCompensatoryOptionAction,
} from "@/app/actions";
import { ABSENCE_STATUS_LABEL, ACTIVE_STATUSES, type AbsenceStatus } from "@/domain/absences";
import type { BalanceSummary } from "@/domain/balance";
import { formatRange, isIsoDate, spanDays } from "@/domain/dates";
import { STATUS_TONE } from "./absence-style";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Stat, Textarea, cx, formatDays } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";

interface Option {
  id: string;
  startDate: string;
  endDate: string;
  label: string | null;
  absence: { id: string; status: AbsenceStatus } | null;
}
interface Group {
  id: string;
  year: number;
  name: string;
  pickCount: number | null;
  notes: string | null;
  options: Option[];
}

const isChosen = (o: Option) => o.absence != null && ACTIVE_STATUSES.has(o.absence.status);

export function CompensatoryView({ groups, today, currentYear, balance }: { groups: Group[]; today: string; currentYear: number; balance: BalanceSummary }) {
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState<{ group: Group; option: Option } | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Saldo de compensados ${currentYear}`}
          description={balance.configured ? undefined : "Sin saldo configurado: puedes indicarlo en Ajustes."}
          action={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Nuevas opciones</Button>}
        />
        <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
          <Stat label="Asignados" value={formatDays(balance.total)} />
          <Stat label="Consumidos" value={formatDays(balance.consumed)} hint="aprobados o disfrutados" />
          <Stat label="Pendientes" value={formatDays(balance.requested)} tone="warning" />
          <Stat label="Disponibles" value={formatDays(balance.available)} tone="primary" />
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gift className="size-5" />}
            title="Aún no has registrado opciones de compensados"
            description="Cuando la empresa os ofrezca fechas para compensar (p. ej. «elige 2 de estas 5»), regístralas aquí. Verás cuáles cogiste y cuáles eran las demás."
            action={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Registrar opciones</Button>}
          />
        </Card>
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} today={today} onChoose={(option) => setChoosing({ group: g, option })} />)
      )}

      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} currentYear={currentYear} />
      <ChooseDialog target={choosing} onClose={() => setChoosing(null)} />
    </div>
  );
}

function GroupCard({ group, today, onChoose }: { group: Group; today: string; onChoose: (o: Option) => void }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const chosen = group.options.filter(isChosen);
  const others = group.options.filter((o) => !isChosen(o));
  const full = group.pickCount != null && chosen.length >= group.pickCount;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {group.name}
            <Badge tone="neutral">{group.year}</Badge>
            <Badge tone={full ? "success" : "warning"}>
              {group.pickCount != null ? `${chosen.length} de ${group.pickCount} elegidas` : `${chosen.length} elegidas`}
            </Badge>
          </span>
        }
        description={group.notes ?? `${group.options.length} opciones ofrecidas`}
        action={
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            aria-label={`Eliminar ${group.name}`}
            onClick={async () => {
              const ok = await confirm({
                title: "¿Eliminar este grupo de opciones?",
                description: "Se borra el listado de opciones. Las ausencias ya elegidas se conservan en «Ausencias».",
                confirmLabel: "Eliminar",
                danger: true,
              });
              if (ok) await run(() => deleteCompensatoryGroupAction(group.id), { success: "Grupo eliminado." });
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <section aria-label="Opciones elegidas">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Las que has cogido</h3>
          {chosen.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-soft">Todavía no has elegido ninguna.</p>
          ) : (
            <ul className="space-y-2">
              {chosen.map((o) => (
                <li key={o.id} className="flex items-center gap-3 rounded-xl border border-approved/30 bg-approved-soft/50 p-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-approved text-surface"><Check className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatRange(o.startDate, o.endDate)}</p>
                    <p className="text-xs text-ink-soft">{o.label ?? `${spanDays(o.startDate, o.endDate)} día(s)`}</p>
                  </div>
                  <Badge tone={STATUS_TONE[o.absence!.status]}>{ABSENCE_STATUS_LABEL[o.absence!.status]}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label="Deshacer elección"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "¿Deshacer esta elección?",
                        description: "Se eliminará la ausencia de compensado creada para esta opción y volverá a quedar disponible.",
                        confirmLabel: "Deshacer",
                        danger: true,
                      });
                      if (ok) await run(() => unchooseCompensatoryOptionAction(o.id), { success: "Elección deshecha." });
                    }}
                  >
                    <Undo2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Otras opciones">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Otras opciones que había</h3>
          {others.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-soft">No quedan más opciones.</p>
          ) : (
            <ul className="space-y-2">
              {others.map((o) => {
                const past = o.endDate < today;
                const wasRejected = o.absence && !ACTIVE_STATUSES.has(o.absence.status);
                return (
                  <li key={o.id} className={cx("flex items-center gap-3 rounded-xl border border-line p-3", (past || full) && "bg-canvas")}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-canvas text-ink-faint">
                      {past ? <X className="size-4" /> : <Gift className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cx("text-sm font-medium", past && "text-ink-faint")}>{formatRange(o.startDate, o.endDate)}</p>
                      <p className="text-xs text-ink-soft">
                        {o.label ?? `${spanDays(o.startDate, o.endDate)} día(s)`}
                        {past && " · ya pasada"}
                        {wasRejected && ` · ${ABSENCE_STATUS_LABEL[o.absence!.status].toLowerCase()}`}
                      </p>
                    </div>
                    {!past && (
                      <Button size="sm" variant="subtle" disabled={full || pending} onClick={() => onChoose(o)} title={full ? "Ya has elegido el máximo de opciones" : undefined}>
                        Elegir
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function ChooseDialog({ target, onClose }: { target: { group: Group; option: Option } | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [status, setStatus] = useState<"PLANNED" | "REQUESTED" | "APPROVED" | "TAKEN">("REQUESTED");
  return (
    <Dialog
      open={target != null}
      onClose={onClose}
      title="Elegir opción de compensado"
      description={target ? `${target.group.name} · ${formatRange(target.option.startDate, target.option.endDate)}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={pending}
            onClick={async () => {
              if (!target) return;
              const r = await run(
                (allowOverlap) => chooseCompensatoryOptionAction({ optionId: target.option.id, status, allowOverlap }),
                { success: "Opción elegida y registrada como ausencia." },
              );
              if (r !== undefined) onClose();
            }}
          >
            Elegir
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-soft">Se crea una ausencia de tipo «Compensado» en MyTime. No se envía ninguna solicitud a Jira.</p>
      <Field label="Estado de la solicitud" htmlFor="choose-status">
        <Select id="choose-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="PLANNED">Planificada (aún no solicitada)</option>
          <option value="REQUESTED">Pendiente de aprobación</option>
          <option value="APPROVED">Aprobada</option>
          <option value="TAKEN">Disfrutada</option>
        </Select>
      </Field>
    </Dialog>
  );
}

function CreateGroupDialog({ open, onClose, currentYear }: { open: boolean; onClose: () => void; currentYear: number }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [year, setYear] = useState(currentYear);
  const [pickCount, setPickCount] = useState("");
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState([{ startDate: "", endDate: "", label: "" }]);

  const reset = () => {
    setName("");
    setPickCount("");
    setNotes("");
    setOptions([{ startDate: "", endDate: "", label: "" }]);
  };

  const submit = async () => {
    const payload = {
      year,
      name,
      pickCount: pickCount.trim() ? Number(pickCount) : null,
      notes: notes.trim() || null,
      options: options
        .filter((o) => o.startDate)
        .map((o) => ({ startDate: o.startDate, endDate: o.endDate || o.startDate, label: o.label.trim() || null })),
    };
    const r = await run(() => createCompensatoryGroupAction(payload), { success: "Opciones guardadas." });
    if (r !== undefined) {
      reset();
      onClose();
    }
  };

  const validOptions = options.filter((o) => isIsoDate(o.startDate)).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Registrar opciones de compensados"
      description="Apunta todas las fechas que os han ofrecido, aunque no vayas a cogerlas todas."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !name.trim() || validOptions === 0}>Guardar opciones</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" htmlFor="cg-name" className="sm:col-span-3">
          <Input id="cg-name" placeholder="Compensados por festivos trabajados 2026" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Año" htmlFor="cg-year">
          <Input id="cg-year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </Field>
        <Field label="Cuántas se pueden elegir" htmlFor="cg-pick" hint="Vacío si no hay límite.">
          <Input id="cg-pick" type="number" min={1} value={pickCount} onChange={(e) => setPickCount(e.target.value)} />
        </Field>
        <Field label="Notas" htmlFor="cg-notes" className="sm:col-span-3">
          <Textarea id="cg-notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Opciones ofrecidas</legend>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
              <Input aria-label={`Opción ${i + 1}: desde`} type="date" value={o.startDate} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, startDate: e.target.value, endDate: x.endDate && x.endDate >= e.target.value ? x.endDate : e.target.value } : x)))} />
              <Input aria-label={`Opción ${i + 1}: hasta`} type="date" min={o.startDate} value={o.endDate} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))} />
              <Input aria-label={`Opción ${i + 1}: etiqueta`} className="col-span-2 sm:col-span-1" placeholder="Etiqueta (opcional)" value={o.label} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Button variant="ghost" aria-label={`Quitar opción ${i + 1}`} disabled={options.length === 1} onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOptions((l) => [...l, { startDate: "", endDate: "", label: "" }])}>
          <Plus className="size-4" /> Añadir opción
        </Button>
      </fieldset>
      <p className="mt-4 text-xs text-ink-faint">
        ¿Prefieres indicar solo tus días asignados? Hazlo en <Link href="/ajustes#saldos" className="underline">Ajustes → Saldos</Link>.
      </p>
    </Dialog>
  );
}
