"use client";
import { AlertTriangle, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  clearDemoDataAction,
  createPersonAction,
  createTeamAbsenceAction,
  createTeamAction,
  deletePersonAction,
  deleteTeamAbsenceAction,
  deleteTeamAction,
  seedDemoTeamAction,
  updateTeamAction,
} from "@/app/actions";
import { eachDay, formatDate, formatRange, isoWeekday, WEEKDAY_SHORT } from "@/domain/dates";
import type { DailyAvailability, LowConcentrationWindow, OverlapAlert } from "@/domain/team";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Input, Notice, Select, cx } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";

interface TeamLite { id: string; name: string; minPresent: number | null; isDemo: boolean }
interface Member { id: string; displayName: string; isDemo: boolean }
interface TeamAbs { id: string; personId: string; startDate: string; endDate: string; status: "CONFIRMED" | "TENTATIVE"; isDemo: boolean }

export function TeamView(props: {
  teams: (TeamLite & { size: number })[];
  team: TeamLite | null;
  members: Member[];
  absences: TeamAbs[];
  series: DailyAvailability[];
  alerts: OverlapAlert[];
  windows: LowConcentrationWindow[];
  windowDays: number;
  start: string;
  end: string;
  today: string;
}) {
  const { team, members, absences, series, start, end } = props;
  const router = useRouter();
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<null | "team" | "person" | "absence" | "editTeam">(null);
  const days = eachDay(start, end);

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ desde: start, hasta: end, ventana: String(props.windowDays), ...(team ? { equipo: team.id } : {}), ...patch });
    router.push(`/equipo?${p}`);
  };
  const hasDemo = props.teams.some((t) => t.isDemo);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {props.teams.length > 0 && (
          <Field label="Equipo" htmlFor="t-team">
            <Select id="t-team" className="w-56" value={team?.id ?? ""} onChange={(e) => nav({ equipo: e.target.value })}>
              {props.teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDemo ? " (demo)" : ""}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Desde" htmlFor="t-start"><Input id="t-start" type="date" value={start} onChange={(e) => e.target.value && nav({ desde: e.target.value })} /></Field>
        <Field label="Hasta" htmlFor="t-end"><Input id="t-end" type="date" min={start} value={end} onChange={(e) => e.target.value && nav({ hasta: e.target.value })} /></Field>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog("team")}><Plus className="size-4" /> Equipo</Button>
          {team && <Button variant="secondary" onClick={() => setDialog("person")}><UserPlus className="size-4" /> Persona</Button>}
          {members.length > 0 && <Button onClick={() => setDialog("absence")}><Plus className="size-4" /> Ausencia</Button>}
        </div>
      </div>

      {hasDemo && (
        <Notice tone="warning" title="Estás viendo datos de demostración">
          «Equipo demo» y «Persona demo N» son ficticios, solo para probar la vista. No representan a compañeros reales.{" "}
          <button
            type="button"
            className="inline-flex items-center font-medium underline touch:min-h-11"
            onClick={async () => {
              const ok = await confirm({ title: "¿Borrar los datos de demostración?", description: "Se eliminan el equipo demo, sus personas y ausencias.", confirmLabel: "Borrar", danger: true });
              if (ok) await run(() => clearDemoDataAction(), { success: "Datos de demostración eliminados." });
            }}
          >
            Borrar datos demo
          </button>
        </Notice>
      )}

      {!team ? (
        <Card>
          <EmptyState
            icon={<Users className="size-5" />}
            title="Aún no hay equipos"
            description="Crea tu equipo e introduce manualmente las ausencias que conozcas, o carga datos de demostración claramente marcados para probar la vista. Más adelante podrán llegar desde una fuente autorizada."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setDialog("team")}><Plus className="size-4" /> Crear equipo</Button>
                <Button variant="secondary" disabled={pending} onClick={() => run(() => seedDemoTeamAction(), { success: "Datos de demostración cargados." })}>Cargar datos demo</Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              title={<span className="flex items-center gap-2">{team.name}{team.isDemo && <DemoBadge />}</span>}
              description={`${members.length} personas · cobertura mínima: ${team.minPresent ?? "sin definir"}`}
              action={
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDialog("editTeam")}>Editar</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label="Eliminar equipo"
                    onClick={async () => {
                      const ok = await confirm({ title: `¿Eliminar «${team.name}»?`, description: "Se eliminan sus personas y ausencias registradas.", confirmLabel: "Eliminar", danger: true });
                      if (ok) await run(() => deleteTeamAction(team.id), { success: "Equipo eliminado." });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              }
            />
            {members.length === 0 ? (
              <EmptyState title="Este equipo no tiene personas" action={<Button onClick={() => setDialog("person")}><UserPlus className="size-4" /> Añadir persona</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 min-w-40 border-b border-line bg-surface px-4 py-2 text-left font-medium text-ink-soft">Persona</th>
                      {days.map((d) => (
                        <th scope="col" key={d} className={cx("w-7 min-w-7 border-b border-line px-0 py-1 text-center font-normal", isoWeekday(d) >= 6 && "bg-weekend", d === props.today && "text-primary")}>
                          <span className="block text-[9px] text-ink-faint">{WEEKDAY_SHORT[isoWeekday(d) - 1]}</span>
                          <span className="tabular font-medium">{Number(d.slice(8))}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-1.5 text-left font-medium">
                          <span className="flex items-center gap-1.5">
                            {m.displayName} {m.isDemo && <DemoBadge />}
                            <button
                              type="button"
                              aria-label={`Eliminar a ${m.displayName}`}
                              className="ml-auto rounded p-0.5 text-ink-faint hover:text-danger"
                              onClick={async () => {
                                const ok = await confirm({ title: `¿Eliminar a ${m.displayName}?`, description: "Se eliminan también sus ausencias registradas.", confirmLabel: "Eliminar", danger: true });
                                if (ok) await run(() => deletePersonAction(m.id), { success: "Persona eliminada." });
                              }}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </span>
                        </th>
                        {days.map((d) => {
                          const a = absences.find((x) => x.personId === m.id && x.startDate <= d && x.endDate >= d);
                          return (
                            <td key={d} className={cx("h-8 border-b border-line p-0.5", isoWeekday(d) >= 6 && "bg-weekend")}>
                              {a && (
                                <button
                                  type="button"
                                  title={`${m.displayName}: ausente ${formatRange(a.startDate, a.endDate)}${a.status === "TENTATIVE" ? " (sin confirmar)" : ""}. Pulsa para eliminar.`}
                                  aria-label={`${m.displayName} ausente el ${formatDate(d)}${a.status === "TENTATIVE" ? " (sin confirmar)" : ""}`}
                                  onClick={async () => {
                                    const ok = await confirm({ title: "¿Eliminar esta ausencia?", description: `${m.displayName} · ${formatRange(a.startDate, a.endDate)}`, confirmLabel: "Eliminar", danger: true });
                                    if (ok) await run(() => deleteTeamAbsenceAction(a.id), { success: "Ausencia eliminada." });
                                  }}
                                  className={cx("block size-full rounded", a.status === "TENTATIVE" ? "border border-dashed border-team bg-team-soft" : "bg-team/80")}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium text-ink-soft">Ausentes / cobertura</th>
                      {series.map((s) => (
                        <td key={s.date} className="p-0.5 text-center">
                          <span
                            title={`${s.absent} ausentes${s.tentative ? ` + ${s.tentative} sin confirmar` : ""} · ${s.present} presentes`}
                            className={cx(
                              "tabular grid h-7 place-items-center rounded text-[11px] font-semibold",
                              s.coverage === "ok" && "bg-approved-soft text-approved",
                              s.coverage === "warning" && "bg-pending-soft text-pending",
                              s.coverage === "critical" && "bg-danger-soft text-danger",
                              s.coverage === "non_working" && "text-ink-faint",
                            )}
                          >
                            {s.coverage === "non_working" ? "·" : s.absent + s.tentative}
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-team/80" /> Ausente</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-team bg-team-soft" /> Sin confirmar</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-approved-soft" /> Cobertura correcta</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-pending-soft" /> Ajustada</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-danger-soft" /> Bajo el mínimo</span>
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Posibles coincidencias" description="Días con muchas ausencias simultáneas o cobertura insuficiente." />
              {props.alerts.length === 0 ? (
                <p className="p-5 text-sm text-ink-soft">Sin problemas de cobertura en este periodo.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {props.alerts.map((a) => (
                    <li key={a.start} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <AlertTriangle className={cx("size-4 shrink-0", a.level === "critical" ? "text-danger" : "text-pending")} aria-hidden />
                      <span className="flex-1">{formatRange(a.start, a.end)}</span>
                      <Badge tone={a.level === "critical" ? "danger" : "warning"}>hasta {a.maxAbsent} ausentes</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Periodos más tranquilos"
                description="Ventanas de días laborables con menos ausencias del equipo."
                action={
                  <label className="flex items-center gap-2 text-xs text-ink-soft">
                    Días
                    <Input type="number" min={1} max={20} className="h-8 w-16" defaultValue={props.windowDays} onBlur={(e) => nav({ ventana: e.target.value })} aria-label="Duración de la ventana en días laborables" />
                  </label>
                }
              />
              {props.windows.length === 0 ? (
                <p className="p-5 text-sm text-ink-soft">El periodo es demasiado corto para esa ventana.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {props.windows.map((w) => (
                    <li key={w.start} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="flex-1">{formatRange(w.start, w.end)}</span>
                      <Badge tone={w.personDays === 0 ? "success" : "info"}>{w.personDays === 0 ? "Nadie ausente" : `${w.personDays} días-persona`}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <TeamDialog open={dialog === "team" || dialog === "editTeam"} team={dialog === "editTeam" ? team : null} onClose={() => setDialog(null)} />
      {team && <PersonDialog open={dialog === "person"} teamId={team.id} onClose={() => setDialog(null)} />}
      <TeamAbsenceDialog open={dialog === "absence"} members={members} defaultDate={props.today} onClose={() => setDialog(null)} />
    </div>
  );
}

function TeamDialog({ open, team, onClose }: { open: boolean; team: TeamLite | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [min, setMin] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={team ? "Editar equipo" : "Nuevo equipo"}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const input = { name: name || team?.name || "", minPresent: min === "" ? (team?.minPresent ?? null) : Number(min) };
              const r = await run(() => (team ? updateTeamAction(team.id, input) : createTeamAction(input)), { success: "Equipo guardado." });
              if (r !== undefined) { setName(""); setMin(""); onClose(); }
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" htmlFor="tm-name"><Input id="tm-name" defaultValue={team?.name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mínimo de personas presentes" htmlFor="tm-min" hint="Se usa para las alertas de cobertura. Opcional.">
          <Input id="tm-min" type="number" min={0} defaultValue={team?.minPresent ?? ""} onChange={(e) => setMin(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function PersonDialog({ open, teamId, onClose }: { open: boolean; teamId: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Añadir persona"
      description="Usa un nombre o alias; solo se guarda su disponibilidad."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={pending || !name.trim()} onClick={async () => {
            const r = await run(() => createPersonAction({ displayName: name, teamId }), { success: "Persona añadida." });
            if (r !== undefined) { setName(""); onClose(); }
          }}>Añadir</Button>
        </>
      }
    >
      <Field label="Nombre o alias" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Dialog>
  );
}

function TeamAbsenceDialog({ open, members, defaultDate, onClose }: { open: boolean; members: Member[]; defaultDate: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(defaultDate);
  const [status, setStatus] = useState<"CONFIRMED" | "TENTATIVE">("CONFIRMED");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ausencia de un compañero"
      description="Solo fechas: no anotes motivos ni datos personales."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={pending} onClick={async () => {
            const r = await run(() => createTeamAbsenceAction({ personId: personId || members[0]?.id, startDate: start, endDate: end, status }), { success: "Ausencia registrada." });
            if (r !== undefined) onClose();
          }}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Persona" htmlFor="ta-person">
          <Select id="ta-person" value={personId || members[0]?.id} onChange={(e) => setPersonId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" htmlFor="ta-start"><Input id="ta-start" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></Field>
          <Field label="Hasta" htmlFor="ta-end"><Input id="ta-end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Estado" htmlFor="ta-status">
          <Select id="ta-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="CONFIRMED">Confirmada</option>
            <option value="TENTATIVE">Sin confirmar</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
