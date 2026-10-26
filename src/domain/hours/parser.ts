/**
 * Intérprete determinista de imputaciones de horas escritas o dictadas.
 *
 * Ejemplos admitidos:
 *   "4h en PROJ-123 login, 2h30 reunión cliente alfa y el resto soporte"
 *   "ayer de 8 a 12 en alfa, de 12 a 15 formación"
 *   "el lunes dos horas y media daily, media hora correo"
 *
 * No usa IA: reglas de texto, coincidencia con claves Jira y alias de cada
 * proyecto/tarea configurado. Siempre se muestra una vista previa para que el
 * usuario confirme antes de guardar.
 */
import { addDays, isIsoDate, isoWeekday, makeIso, yearOf, type IsoDate } from "../dates";

export interface ParserWorkItem {
  id: string;
  label: string;
  jiraIssueKey: string | null;
  aliases: string[];
}

export interface ParseContext {
  workItems: ParserWorkItem[];
  referenceDate: IsoDate;
  /** Minutos esperados para la fecha detectada (para "el resto"). */
  expectedMinutesFor: (date: IsoDate) => number;
  /** Minutos ya imputados para la fecha detectada. */
  loggedMinutesFor: (date: IsoDate) => number;
}

export type Confidence = "high" | "medium" | "low";

export interface ParsedEntry {
  segment: string;
  date: IsoDate;
  minutes: number | null;
  workItemId: string | null;
  issueKey: string | null;
  description: string | null;
  confidence: Confidence;
  issues: string[];
  candidates: string[];
}

export interface ParseResult {
  date: IsoDate;
  dateDetected: boolean;
  entries: ParsedEntry[];
  totalMinutes: number;
  warnings: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20,
  treinta: 30, cuarenta: 40, cuarentaicinco: 45,
};

const WEEKDAYS: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
};

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const ISSUE_KEY_RE = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d{1,7})\b/;

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Sustituye expresiones habladas por formas numéricas ("dos horas y media" → "2.5h"). */
function canonicalize(text: string): string {
  let t = ` ${normalize(text)} `;
  t = t.replace(/ cuarenta y cinco /g, " 45 ");
  const words = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|");
  t = t.replace(new RegExp(`\\b(${words})\\b(?=\\s+(horas?|h|minutos?|min)\\b)`, "g"), (w) => String(NUMBER_WORDS[w]));
  t = t.replace(/\b(?:una )?hora y media\b/g, "1.5h");
  t = t.replace(/\b(\d+)\s*(?:horas?|h) y media\b/g, (_, h) => `${Number(h) + 0.5}h`);
  t = t.replace(/\b(\d+)\s*(?:horas?|h) y cuarto\b/g, (_, h) => `${Number(h) + 0.25}h`);
  t = t.replace(/\b(\d+)\s*(?:horas?|h) y tres cuartos\b/g, (_, h) => `${Number(h) + 0.75}h`);
  t = t.replace(/\bmedia hora\b/g, "30min");
  t = t.replace(/\b(?:un )?cuarto de hora\b/g, "15min");
  t = t.replace(/\btres cuartos de hora\b/g, "45min");
  return t.trim();
}

function resolveDate(text: string, ref: IsoDate): { date: IsoDate; detected: boolean; rest: string } {
  const patterns: [RegExp, (m: RegExpExecArray) => IsoDate | null][] = [
    [/\banteayer\b/, () => addDays(ref, -2)],
    [/\bayer\b/, () => addDays(ref, -1)],
    [/\bhoy\b/, () => ref],
    [
      /\b(?:el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?: pasado)?\b/,
      (m) => {
        const target = WEEKDAYS[m[1]];
        let diff = isoWeekday(ref) - target;
        if (diff < 0) diff += 7;
        return addDays(ref, -diff);
      },
    ],
    [
      /\b(?:el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de (\d{4}))?\b/,
      (m) => makeIso(m[3] ? Number(m[3]) : yearOf(ref), MONTHS[m[2]], Number(m[1])),
    ],
    [
      /\b(?:el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b(?!\s*(?:h|horas?|min))/,
      (m) => makeIso(m[3] ? Number(m[3]) : yearOf(ref), Number(m[2]), Number(m[1])),
    ],
    [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => m[1]],
  ];
  for (const [re, fn] of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (date && isIsoDate(date)) return { date, detected: true, rest: text.replace(m[0], " ") };
  }
  return { date: ref, detected: false, rest: text };
}

interface DurationMatch {
  minutes: number | null;
  remainder: boolean;
  fullDay: boolean;
  matched: string;
}

function extractDuration(seg: string): DurationMatch | null {
  // Rango horario: "de 8 a 12", "de 8:30 a 10", "8-12h"
  const range = /\b(?:de\s+)?(\d{1,2})(?:[:.h](\d{2}))?\s*(?:a|-|hasta)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(?:h\b)?/.exec(seg);
  if (range && /\bde\s+\d|\d\s*-\s*\d/.test(range[0])) {
    const start = Number(range[1]) * 60 + Number(range[2] ?? 0);
    const end = Number(range[3]) * 60 + Number(range[4] ?? 0);
    if (end > start && end <= 24 * 60) return { minutes: end - start, remainder: false, fullDay: false, matched: range[0] };
  }
  // "2:30 h", "2:30 horas"
  const clock = /\b(\d{1,2}):(\d{2})\s*(?:h|horas?)\b/.exec(seg);
  if (clock) return { minutes: Number(clock[1]) * 60 + Number(clock[2]), remainder: false, fullDay: false, matched: clock[0] };
  // "2h30", "2 h 30 min", "1.5 horas", "1,5h"
  const hours = /\b(\d+(?:[.,]\d+)?)\s*(?:horas?|hrs|hr|h)(?![a-z])(?:\s*(?:y\s*)?(\d{1,2})\s*(?:m|min|minutos?)?\b)?/.exec(seg);
  if (hours) {
    const h = Number(hours[1].replace(",", "."));
    const extra = hours[2] ? Number(hours[2]) : 0;
    return { minutes: Math.round(h * 60) + extra, remainder: false, fullDay: false, matched: hours[0] };
  }
  const mins = /\b(\d+)\s*(?:m|min|mins|minutos?)\b/.exec(seg);
  if (mins) return { minutes: Number(mins[1]), remainder: false, fullDay: false, matched: mins[0] };
  const rest = /\b(?:el resto(?: del dia)?|lo demas|lo que queda|resto)\b/.exec(seg);
  if (rest) return { minutes: null, remainder: true, fullDay: false, matched: rest[0] };
  const full = /\b(?:todo el dia|jornada completa|dia completo|toda la jornada)\b/.exec(seg);
  if (full) return { minutes: null, remainder: false, fullDay: true, matched: full[0] };
  return null;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

interface ItemMatch {
  item: ParserWorkItem | null;
  issueKey: string | null;
  matched: string | null;
  exact: boolean;
  candidates: ParserWorkItem[];
}

function matchItem(segOriginal: string, segNorm: string, items: ParserWorkItem[]): ItemMatch {
  const key = ISSUE_KEY_RE.exec(segOriginal);
  if (key) {
    const issueKey = key[1].toUpperCase();
    const item = items.find((i) => i.jiraIssueKey?.toUpperCase() === issueKey) ?? null;
    return { item, issueKey, matched: normalize(key[1]), exact: true, candidates: [] };
  }

  const padded = ` ${segNorm} `;
  let best: { item: ParserWorkItem; len: number; term: string }[] = [];
  for (const item of items) {
    for (const term of [item.label, ...item.aliases].map(normalize).filter(Boolean)) {
      if (!padded.includes(` ${term} `)) continue;
      if (best.length === 0 || term.length > best[0].len) best = [{ item, len: term.length, term }];
      else if (term.length === best[0].len && !best.some((b) => b.item.id === item.id)) best.push({ item, len: term.length, term });
    }
  }
  if (best.length === 1) return { item: best[0].item, issueKey: best[0].item.jiraIssueKey, matched: best[0].term, exact: true, candidates: [] };
  if (best.length > 1) return { item: null, issueKey: null, matched: null, exact: false, candidates: best.map((b) => b.item) };

  // Tolerancia a errores de transcripción: 1 letra de diferencia en palabras largas.
  const tokens = segNorm.split(/[^a-z0-9ñ]+/).filter((t) => t.length >= 5);
  const fuzzy = new Map<string, { item: ParserWorkItem; term: string }>();
  for (const item of items) {
    for (const term of [item.label, ...item.aliases].map(normalize)) {
      if (term.length < 5 || term.includes(" ")) continue;
      const hit = tokens.find((t) => levenshtein(t, term) <= 1);
      if (hit) fuzzy.set(item.id, { item, term: hit });
    }
  }
  if (fuzzy.size === 1) {
    const [{ item, term }] = [...fuzzy.values()];
    return { item, issueKey: item.jiraIssueKey, matched: term, exact: false, candidates: [] };
  }
  return { item: null, issueKey: null, matched: null, exact: false, candidates: [...fuzzy.values()].map((f) => f.item) };
}

const FILLER = /^(?:y|en|de|del|para|con|a|al|el|la|los|las|por|sobre|haciendo|trabajando|tarea|proyecto|luego|despues|mas)\b\s*/;

function cleanDescription(segNorm: string, removals: (string | null)[]): string | null {
  let d = ` ${segNorm} `;
  for (const r of removals) if (r) d = d.replace(r, " ");
  d = d.replace(/\s+/g, " ").trim();
  let prev = "";
  while (prev !== d) {
    prev = d;
    d = d.replace(FILLER, "").trim();
  }
  d = d.replace(/\s+(?:y|en|de|con|para)$/, "").trim();
  return d.length >= 2 ? d.charAt(0).toUpperCase() + d.slice(1) : null;
}

/** Recupera tildes y mayúsculas de las palabras tal y como se escribieron. */
function restoreOriginalWords(description: string | null, original: string): string | null {
  if (!description) return null;
  const byNorm = new Map<string, string>();
  for (const w of original.split(/[\s,;.:()]+/)) if (w && !byNorm.has(normalize(w))) byNorm.set(normalize(w), w);
  const restored = description
    .split(" ")
    .map((w, i) => {
      const o = byNorm.get(w.toLowerCase());
      if (!o) return w;
      return i === 0 ? o.charAt(0).toUpperCase() + o.slice(1) : o;
    })
    .join(" ");
  return restored;
}

function splitSegments(text: string): string[] {
  return text
    .split(/\n|;|(?<!\d),|,(?!\d)|\s+y\s+(?=(?:\d|de\s+\d|el resto|lo demas|media|todo el)|[a-z]+\s+\d)|\s+(?:luego|despues|ademas|mas)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseHoursText(text: string, ctx: ParseContext): ParseResult {
  const warnings: string[] = [];
  const canon = canonicalize(text);
  const { date, detected, rest } = resolveDate(canon, ctx.referenceDate);

  const originalSegments = splitSegments(text.normalize("NFC"));
  const segments = splitSegments(rest);
  const raw: { seg: string; dur: DurationMatch | null; match: ItemMatch }[] = segments.map((seg, idx) => {
    const original = originalSegments[idx] ?? seg;
    return { seg, dur: extractDuration(seg), match: matchItem(original, seg, ctx.workItems) };
  });

  // Une un segmento con solo duración al siguiente con solo proyecto ("3 horas", "en alfa").
  const merged: typeof raw = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const next = raw[i + 1];
    if (cur.dur && !cur.match.item && !cur.match.issueKey && next && !next.dur && (next.match.item || next.match.issueKey)) {
      merged.push({ seg: `${cur.seg} ${next.seg}`, dur: cur.dur, match: next.match });
      i++;
    } else if (!cur.dur && merged.length > 0 && !(cur.match.item || cur.match.issueKey)) {
      // Texto sin duración ni proyecto: se añade a la descripción anterior.
      merged[merged.length - 1].seg += ` ${cur.seg}`;
    } else {
      merged.push(cur);
    }
  }

  const expected = ctx.expectedMinutesFor(date);
  const logged = ctx.loggedMinutesFor(date);
  const entries: ParsedEntry[] = [];
  let explicit = 0;
  for (const r of merged) if (r.dur?.minutes) explicit += r.dur.minutes;

  for (const r of merged) {
    const issues: string[] = [];
    let minutes = r.dur?.minutes ?? null;
    if (r.dur?.remainder) {
      minutes = Math.max(0, expected - logged - explicit);
      if (minutes === 0) issues.push("No queda tiempo pendiente para \"el resto\" en ese día.");
    } else if (r.dur?.fullDay) {
      minutes = expected;
      if (expected === 0) issues.push("Ese día no tiene horas esperadas en tu jornada.");
    }
    if (minutes == null) issues.push("No se ha encontrado la duración.");
    else if (minutes <= 0 && !r.dur?.remainder) issues.push("La duración debe ser mayor que cero.");
    else if (minutes > 16 * 60) issues.push("Duración superior a 16 horas.");

    if (!r.match.item) {
      if (r.match.issueKey) issues.push(`La tarea ${r.match.issueKey} no está entre tus proyectos configurados.`);
      else if (r.match.candidates.length > 1) issues.push("Coincide con varios proyectos: elige uno.");
      else issues.push("No se ha reconocido el proyecto o la tarea.");
    }

    const confidence: Confidence =
      r.match.item && minutes != null && minutes > 0 ? (r.match.exact ? "high" : "medium") : "low";
    entries.push({
      segment: r.seg,
      date,
      minutes,
      workItemId: r.match.item?.id ?? null,
      issueKey: r.match.issueKey,
      description: restoreOriginalWords(cleanDescription(r.seg, [r.dur?.matched ?? null, r.match.matched]), text),
      confidence,
      issues,
      candidates: r.match.candidates.map((c) => c.id),
    });
  }

  const totalMinutes = entries.reduce((s, e) => s + (e.minutes ?? 0), 0);
  if (entries.length === 0) warnings.push("No se ha encontrado ninguna imputación en el texto.");
  if (expected === 0 && entries.length > 0) warnings.push("La fecha no es un día laborable según tu calendario y jornada.");
  else if (logged + totalMinutes > expected && expected > 0)
    warnings.push(`El total del día (${Math.round(((logged + totalMinutes) / 60) * 100) / 100} h) supera tu jornada esperada.`);
  if (date > ctx.referenceDate) warnings.push("La fecha detectada es futura.");

  return { date, dateDetected: detected, entries, totalMinutes, warnings };
}
