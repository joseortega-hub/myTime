"use client";
import { ChevronLeft, ChevronRight, CloudUpload, FolderKanban, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  createTimeEntriesAction,
  deleteTimeEntryAction,
  deleteWorkItemAction,
  interpretHoursAction,
  pushEntriesToJiraAction,
  saveWorkItemAction,
  updateTimeEntryAction,
} from "@/app/actions";
import { addDays, formatDate, formatRange } from "@/domain/dates";
import type { ParseResult } from "@/domain/hours/parser";
import { formatMinutes } from "@/domain/hours/schedule";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, Select, Textarea, cx } from "./ui";
import { Dialog, useAction, useConfirm } from "./ui-client";
import { VoiceInput } from "./voice-input";

interface Item { id: string; label: string; projectName: string | null; jiraIssueKey: string | null; aliases: string[]; active: boolean }
interface Entry { id: string; date: string; workItemId: string; minutes: number; description: string | null; syncStatus: "LOCAL" | "QUEUED" | "SYNCED" | "ERROR"; syncError: string | null; label: string; issueKey: string | null }
interface Day { date: string; working: boolean; holiday: string | null; expected: number; logged: number; entries: Entry[] }

/** "2:30", "2h30", "2,5", "150m" → minutos. */
export function parseDurationInput(v: string): number | null {
  const s = v.trim().toLowerCase().replace(",", ".");
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})\s*h\s*(\d{1,2})?\s*m?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d+)\s*m(in)?$/.exec(s);
  if (m) return Number(m[1]);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
}
const toHm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

const SYNC_BADGE: Record<Entry["syncStatus"], { tone: "neutral" | "info" | "success" | "danger"; label: string }> = {
  LOCAL: { tone: "neutral", label: "Solo local" },
  QUEUED: { tone: "info", label: "Enviando" },
  SYNCED: { tone: "success", label: "En Jira" },
  ERROR: { tone: "danger", label: "Error" },
};

export function HoursView({ today, weekStart, week, items, jira }: { today: string; weekStart: string; week: Day[]; items: Item[]; jira: { mode: string; writeEnabled: boolean } }) {
  const activeItems = items.filter((i) => i.active);
  const [editing, setEditing] = useState<Entry | { date: string } | null>(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const { run, pending } = useAction();
  const confirm = useConfirm();

  const weekExpected = week.reduce((s, d) => s + d.expected, 0);
  const weekLogged = week.reduce((s, d) => s + d.logged, 0);
  const pendingSync = week.flatMap((d) => d.entries).filter((e) => e.syncStatus !== "SYNCED");

  return (
    <div className="space-y-6">
      {activeItems.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="Primero, tus proyectos y tareas"
            description="Añade cada proyecto o tarea a la que imputas horas, con su clave de Jira (si la conoces) y las palabras con las que lo nombras. Así MyTime sabrá a dónde va cada hora."
            action={<Button onClick={() => setItemsOpen(true)}><Plus className="size-4" /> Añadir proyectos</Button>}
          />
        </Card>
      ) : (
        <QuickEntry today={today} items={activeItems} />
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-1">
            <Link href={`/horas?semana=${addDays(weekStart, -7)}`} className="rounded-lg p-2 text-ink-soft hover:bg-hover" aria-label="Semana anterior"><ChevronLeft className="size-5" /></Link>
            <h2 className="min-w-48 text-center font-semibold">{formatRange(weekStart, addDays(weekStart, 6))}</h2>
            <Link href={`/horas?semana=${addDays(weekStart, 7)}`} className="rounded-lg p-2 text-ink-soft hover:bg-hover" aria-label="Semana siguiente"><ChevronRight className="size-5" /></Link>
            <Link href="/horas" className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft">Esta semana</Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="tabular"><span className="font-semibold">{formatMinutes(weekLogged)}</span> <span className="text-ink-soft">de {formatMinutes(weekExpected)}</span></span>
            <Button size="sm" variant="secondary" onClick={() => setItemsOpen(true)}><FolderKanban className="size-4" /> Proyectos</Button>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {week.map((d) => {
            const diff = d.logged - d.expected;
            const pct = d.expected > 0 ? Math.min(100, (d.logged / d.expected) * 100) : d.logged > 0 ? 100 : 0;
            return (
              <li key={d.date} className={cx("px-5 py-4", !d.working && "bg-weekend/50", d.date === today && "bg-primary-soft/30")}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-36">
                    <p className="text-sm font-medium capitalize">{formatDate(d.date, "weekday")}</p>
                    <p className="text-xs text-ink-soft">{d.holiday ? `Festivo: ${d.holiday}` : !d.working ? "No laborable" : d.expected === 0 ? "Ausencia" : `Jornada ${formatMinutes(d.expected)}`}</p>
                  </div>
                  <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={d.logged} aria-valuemin={0} aria-valuemax={d.expected} aria-label={`Registrado ${formatMinutes(d.logged)} de ${formatMinutes(d.expected)}`}>
                    <div className={cx("h-full rounded-full", diff > 0 ? "bg-pending" : diff === 0 && d.expected > 0 ? "bg-approved" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="w-28 text-right text-sm tabular">
                    {formatMinutes(d.logged)}
                    {d.expected > 0 && diff !== 0 && <span className={cx("block text-xs", diff > 0 ? "text-pending" : "text-ink-faint")}>{diff > 0 ? `+${formatMinutes(diff)}` : `faltan ${formatMinutes(-diff)}`}</span>}
                  </p>
                  <Button size="sm" variant="ghost" aria-label={`Añadir horas el ${formatDate(d.date)}`} onClick={() => setEditing({ date: d.date })} disabled={activeItems.length === 0}><Plus className="size-4" /></Button>
                </div>
                {d.entries.length > 0 && (
                  <ul className="mt-3 space-y-1.5 sm:pl-36">
                    {d.entries.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                        <span className="w-14 font-medium tabular">{toHm(e.minutes)}</span>
                        <span className="font-medium">{e.label}</span>
                        {e.issueKey && <code className="rounded bg-canvas px-1.5 text-xs text-ink-soft">{e.issueKey}</code>}
                        {e.description && <span className="min-w-0 flex-1 truncate text-ink-soft">{e.description}</span>}
                        <Badge tone={SYNC_BADGE[e.syncStatus].tone} title={e.syncError ?? undefined}>{SYNC_BADGE[e.syncStatus].label}</Badge>
                        <div className="ml-auto flex">
                          <Button size="sm" variant="ghost" aria-label="Editar" disabled={e.syncStatus === "SYNCED"} onClick={() => setEditing(e)}><Pencil className="size-3.5" /></Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            aria-label="Eliminar"
                            onClick={async () => {
                              const ok = await confirm({
                                title: "¿Eliminar este registro?",
                                description: e.syncStatus === "SYNCED" ? "Ya se envió a Jira: solo se borra de MyTime, no de Jira." : `${toHm(e.minutes)} en ${e.label}.`,
                                confirmLabel: "Eliminar",
                                danger: true,
                              });
                              if (ok) await run(() => deleteTimeEntryAction(e.id), { success: "Registro eliminado." });
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Imputar en Jira"
          description={
            jira.mode === "disabled"
              ? "Integración desactivada: tus horas se guardan solo en MyTime."
              : jira.mode === "mock"
                ? "Modo SIMULADO: se marca como enviado sin contactar con ningún servidor."
                : jira.writeEnabled
                  ? "Escritura autorizada: se crearán imputaciones (worklogs) en las tareas indicadas."
                  : "La integración es de solo lectura: la escritura de imputaciones no está habilitada."
          }
          action={
            <Button
              disabled={!jira.writeEnabled || pendingSync.length === 0 || pending}
              onClick={async () => {
                const withKey = pendingSync.filter((e) => e.issueKey);
                const ok = await confirm({
                  title: `¿Enviar ${withKey.length} registros a Jira?`,
                  description: jira.mode === "mock" ? "Modo simulado: no se enviará nada a ningún servidor." : "Se crearán imputaciones en Jira con estas horas. Revisa antes que todo es correcto.",
                  confirmLabel: "Enviar",
                });
                if (ok) await run(() => pushEntriesToJiraAction(pendingSync.map((e) => e.id)), { success: "Envío terminado." });
              }}
            >
              <CloudUpload className="size-4" /> Enviar semana ({pendingSync.length})
            </Button>
          }
        />
        {!jira.writeEnabled && (
          <p className="px-5 py-4 text-sm text-ink-soft">
            Para activarlo hace falta una integración autorizada por la empresa. Mientras tanto puedes exportar las horas en CSV desde{" "}
            <Link href="/ajustes#datos" className="font-medium text-primary underline">Ajustes → Datos</Link>.
          </p>
        )}
      </Card>

      <EntryDialog target={editing} items={activeItems} onClose={() => setEditing(null)} />
      <WorkItemsDialog open={itemsOpen} items={items} onClose={() => setItemsOpen(false)} />
    </div>
  );
}

interface PreviewRow { key: number; date: string; workItemId: string; duration: string; description: string; confidence: "high" | "medium" | "low"; issues: string[]; segment: string }

function QuickEntry({ today, items }: { today: string; items: Item[] }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(today);
  const [preview, setPreview] = useState<{ result: ParseResult; rows: PreviewRow[]; method: "TEXT" | "VOICE" } | null>(null);
  const [usedVoice, setUsedVoice] = useState(false);
  const { run, pending } = useAction();

  const interpret = async () => {
    const r = await run(() => interpretHoursAction(text, date), { refresh: false });
    if (!r) return;
    setPreview({
      result: r,
      method: usedVoice ? "VOICE" : "TEXT",
      rows: r.entries.map((e, i) => ({
        key: i,
        date: e.date,
        workItemId: e.workItemId ?? e.candidates[0] ?? "",
        duration: e.minutes ? toHm(e.minutes) : "",
        description: e.description ?? "",
        confidence: e.confidence,
        issues: e.issues,
        segment: e.segment,
      })),
    });
  };

  const save = async () => {
    if (!preview) return;
    const entries = preview.rows.map((r) => ({
      date: r.date,
      workItemId: r.workItemId,
      minutes: parseDurationInput(r.duration) ?? 0,
      description: r.description || null,
      inputMethod: preview.method,
    }));
    const res = await run(() => createTimeEntriesAction(entries), { success: `${entries.length} registros guardados.` });
    if (res !== undefined) {
      setPreview(null);
      setText("");
      setUsedVoice(false);
    }
  };

  const setRow = (key: number, patch: Partial<PreviewRow>) =>
    setPreview((p) => (p ? { ...p, rows: p.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : p));
  const allValid = preview?.rows.every((r) => r.workItemId && (parseDurationInput(r.duration) ?? 0) > 0) ?? false;
  const total = preview?.rows.reduce((s, r) => s + (parseDurationInput(r.duration) ?? 0), 0) ?? 0;

  return (
    <Card>
      <CardHeader title="Registrar horas" description="Ejemplo: «4h en PROJ-12 login, 2h30 reunión cliente y el resto soporte» · «ayer de 8 a 12 alfa»" />
      <div className="space-y-3 p-5">
        <label htmlFor="hours-text" className="sr-only">Describe tus horas</label>
        <Textarea
          id="hours-text"
          rows={3}
          maxLength={2000}
          placeholder="¿En qué has trabajado hoy?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) void interpret();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="hours-date" className="text-sm text-ink-soft">Fecha de referencia</label>
          <Input id="hours-date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          <VoiceInput onText={(t) => { setUsedVoice(true); setText((cur) => (cur ? `${cur} ${t}` : t)); }} />
          <Button className="ml-auto" onClick={interpret} disabled={pending || !text.trim()}>
            <Wand2 className="size-4" /> Interpretar
          </Button>
        </div>

        {preview && (
          <div className="mt-2 rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-4 py-2.5 text-sm">
              <p>
                Vista previa para <span className="font-medium">{formatDate(preview.result.date, "long")}</span>
                {preview.result.dateDetected && <Badge tone="info" className="ml-2">fecha detectada en el texto</Badge>}
              </p>
              <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" aria-label="Descartar vista previa" onClick={() => setPreview(null)}><X className="size-4" /></button>
            </div>
            {preview.result.warnings.length > 0 && (
              <Notice tone="warning" className="m-3"><ul className="list-disc pl-4">{preview.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>
            )}
            <ul className="divide-y divide-line">
              {preview.rows.map((r) => (
                <li key={r.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_1fr_90px_1.3fr_auto] sm:items-center">
                  <Input aria-label="Fecha" type="date" value={r.date} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                  <Select aria-label="Proyecto o tarea" value={r.workItemId} onChange={(e) => setRow(r.key, { workItemId: e.target.value })} aria-invalid={!r.workItemId}>
                    <option value="">Elige proyecto…</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.label}{i.jiraIssueKey ? ` · ${i.jiraIssueKey}` : ""}</option>)}
                  </Select>
                  <Input aria-label="Duración (h:mm)" placeholder="h:mm" value={r.duration} onChange={(e) => setRow(r.key, { duration: e.target.value })} aria-invalid={!(parseDurationInput(r.duration) ?? 0)} />
                  <Input aria-label="Descripción" placeholder="Descripción" value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} />
                  <div className="flex items-center gap-1">
                    <Badge tone={r.confidence === "high" ? "success" : r.confidence === "medium" ? "warning" : "danger"}>
                      {r.confidence === "high" ? "Seguro" : r.confidence === "medium" ? "Revisar" : "Incompleto"}
                    </Badge>
                    <Button size="sm" variant="ghost" aria-label="Quitar fila" onClick={() => setPreview((p) => (p ? { ...p, rows: p.rows.filter((x) => x.key !== r.key) } : p))}><X className="size-4" /></Button>
                  </div>
                  <p className="text-xs text-ink-faint sm:col-span-5">
                    «{r.segment}»{r.issues.length > 0 && <span className="text-pending"> · {r.issues.join(" ")}</span>}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
              <p className="text-sm">Total: <span className="font-semibold tabular">{formatMinutes(total)}</span></p>
              <Button onClick={save} disabled={pending || !allValid || preview.rows.length === 0}>Guardar {preview.rows.length} registros</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function EntryDialog({ target, items, onClose }: { target: Entry | { date: string } | null; items: Item[]; onClose: () => void }) {
  const editing = target && "id" in target ? target : null;
  return (
    <Dialog open={target != null} onClose={onClose} title={editing ? "Editar registro" : "Añadir horas"} description={target ? formatDate(target.date, "long") : undefined} size="sm">
      {target && <EntryForm key={editing?.id ?? target.date} target={target} items={items} onDone={onClose} />}
    </Dialog>
  );
}

function EntryForm({ target, items, onDone }: { target: Entry | { date: string }; items: Item[]; onDone: () => void }) {
  const editing = "id" in target ? target : null;
  const [workItemId, setWorkItemId] = useState(editing?.workItemId ?? items[0]?.id ?? "");
  const [duration, setDuration] = useState(editing ? toHm(editing.minutes) : "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [date, setDate] = useState(target.date);
  const { run, pending, fieldErrors } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { date, workItemId, minutes: parseDurationInput(duration) ?? 0, description: description || null, inputMethod: "MANUAL" as const };
    const r = await run<unknown>(() => (editing ? updateTimeEntryAction(editing.id, input) : createTimeEntriesAction([input])), { success: "Horas guardadas." });
    if (r !== undefined) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Fecha" htmlFor="en-date"><Input id="en-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Proyecto o tarea" htmlFor="en-item">
        <Select id="en-item" value={workItemId} onChange={(e) => setWorkItemId(e.target.value)}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.label}{i.jiraIssueKey ? ` · ${i.jiraIssueKey}` : ""}</option>)}
        </Select>
      </Field>
      <Field label="Duración" htmlFor="en-dur" hint="Formatos: 2:30, 2h30, 2,5 o 150m" error={fieldErrors.minutes ?? fieldErrors["0.minutes"]}>
        <Input id="en-dur" value={duration} onChange={(e) => setDuration(e.target.value)} />
      </Field>
      <Field label="Descripción (opcional)" htmlFor="en-desc"><Input id="en-desc" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending || !workItemId}>Guardar</Button>
      </div>
    </form>
  );
}

function WorkItemsDialog({ open, items, onClose }: { open: boolean; items: Item[]; onClose: () => void }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const empty = { id: null as string | null, label: "", projectName: "", jiraIssueKey: "", aliases: "" };
  const [form, setForm] = useState(empty);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      label: form.label,
      projectName: form.projectName || null,
      jiraIssueKey: form.jiraIssueKey || null,
      aliases: form.aliases.split(",").map((a) => a.trim()).filter((a) => a.length >= 2),
      active: true,
    };
    const r = await run(() => saveWorkItemAction(form.id, input), { success: "Proyecto guardado." });
    if (r !== undefined) setForm(empty);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Proyectos y tareas" description="A dónde imputas horas. La clave de Jira es opcional y no se valida contra Jira." size="lg">
      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-canvas/50 p-4 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="wi-label"><Input id="wi-label" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Proyecto Alfa – desarrollo" /></Field>
        <Field label="Clave de tarea Jira" htmlFor="wi-key" hint="Ej.: PROJ-123"><Input id="wi-key" value={form.jiraIssueKey} onChange={(e) => setForm({ ...form, jiraIssueKey: e.target.value })} /></Field>
        <Field label="Proyecto (opcional)" htmlFor="wi-project"><Input id="wi-project" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} /></Field>
        <Field label="Alias (separados por comas)" htmlFor="wi-aliases" hint="Palabras con las que lo nombras: alfa, login…"><Input id="wi-aliases" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Cancelar edición</Button>}
          <Button type="submit" disabled={pending || !form.label.trim()}>{form.id ? "Guardar cambios" : "Añadir"}</Button>
        </div>
      </form>
      <ul className="mt-4 divide-y divide-line">
        {items.length === 0 && <li className="py-4 text-center text-sm text-ink-soft">Todavía no hay proyectos.</li>}
        {items.map((i) => (
          <li key={i.id} className={cx("flex flex-wrap items-center gap-2 py-2.5 text-sm", !i.active && "opacity-60")}>
            <span className="font-medium">{i.label}</span>
            {i.jiraIssueKey && <code className="rounded bg-canvas px-1.5 text-xs">{i.jiraIssueKey}</code>}
            {!i.active && <Badge>Inactivo</Badge>}
            {i.aliases.length > 0 && <span className="text-xs text-ink-faint">alias: {i.aliases.join(", ")}</span>}
            <div className="ml-auto flex">
              <Button size="sm" variant="ghost" aria-label={`Editar ${i.label}`} onClick={() => setForm({ id: i.id, label: i.label, projectName: i.projectName ?? "", jiraIssueKey: i.jiraIssueKey ?? "", aliases: i.aliases.join(", ") })}><Pencil className="size-3.5" /></Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                aria-label={`Eliminar ${i.label}`}
                onClick={async () => {
                  const ok = await confirm({ title: `¿Eliminar «${i.label}»?`, description: "Si tiene horas registradas, se desactivará en lugar de borrarse.", confirmLabel: "Eliminar", danger: true });
                  if (ok) await run(() => deleteWorkItemAction(i.id), { success: "Proyecto actualizado." });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
