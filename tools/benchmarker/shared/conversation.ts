// A story run's conversation as the page reads it: the events stream the conversation API serves (every time in
// integer milliseconds, every place in it a cursor), the story run's id, and how a time bar's parts lead to it.
// The API has two forms over one stream: a time range paged by cursor (contiguous by construction, for backfill),
// and "everything after this cursor" whatever its time (for following along). The story's status plays no part.

import type { Seg } from "./runView.ts";

/** A story run's id: its run's record directory and its story number, as the warehouse names it. */
export const STORY_DIR_DIGITS = 2;
export const storyRunId = (dir: string, story: string) => `${dir}/stories/${String(Number(story)).padStart(STORY_DIR_DIGITS, "0")}`;

export type EventKind = "call" | "tool_start" | "tool_end" | "msg" | "compaction_start" | "compaction_end" | "between_sessions" | "request" | "condition";

/** One happening in a story's conversation. The payload's fields ride beside these (see the kinds' views). */
export interface ConversationEvent {
  ord: number;
  tMs: number;
  kind: EventKind | string;
  refIdx: number | null;
  cursor: string;
  [field: string]: unknown;
}

/** A text as an event carries it: whole when short, else its head, tail and length (the whole is on the call page). */
export interface CutText { text?: string; head?: string; tail?: string; chars?: number }

export interface Conversation {
  id: string;
  fmt: string | null;
  complete: boolean;
  node: string | null;
  /** The span of what has been ingested so far: half-open, milliseconds. */
  range: { fromMs: number; toMs: number };
  /** The cursor after the newest event: where following along starts. */
  latest: string;
  events: number;
  counts: { calls: number; toolCalls: number; msgs: number; compactions: number; requests: number; conditions: number };
}

export interface EventsPage {
  events: ConversationEvent[];
  /** The time-range form: where the next page starts, null when the span is exhausted. The open-ended form: the
   * latest stamp, to ask after next time. */
  nextCursor: string | null;
  range: { fromMs: number; toMs: number };
}

export const EVENTS_PAGE_MAX = 500;
/** How often the page asks for what came after its latest cursor. */
export const FOLLOW_POLL_MS = 5_000;

const cursorOf = (e: ConversationEvent) => e.cursor;
const order = (a: ConversationEvent, b: ConversationEvent) => a.tMs - b.tMs || a.ord - b.ord;

/** The page's store of one story's events: pages merged by ord, kept in (time, ord) order, nothing twice. */
export class EventStore {
  private byOrd = new Map<number, ConversationEvent>();
  private sorted: ConversationEvent[] | null = null;
  /** The cursor after the newest event by ord, for the open-ended form. */
  latest: string | null = null;

  add(events: ConversationEvent[]): number {
    let added = 0;
    for (const e of events) {
      if (this.byOrd.has(e.ord)) continue;
      this.byOrd.set(e.ord, e);
      added += 1;
      if (this.latest === null || e.ord > this.latestOrd()) this.latest = cursorOf(e);
    }
    if (added) this.sorted = null;
    return added;
  }

  private latestOrd(): number {
    return this.latest ? Number(this.latest.split(":")[1]) : -1;
  }

  /** Every event, in (time, ord) order. */
  all(): ConversationEvent[] {
    if (!this.sorted) this.sorted = [...this.byOrd.values()].sort(order);
    return this.sorted;
  }

  ofKind(kind: string): ConversationEvent[] {
    return this.all().filter((e) => e.kind === kind);
  }

  get size(): number {
    return this.byOrd.size;
  }
}

/** The conversation page's timeline: `bins` ticks over the story's span, each the number of calls in it and whether a
 * compaction touched it; a tick is a link into the calls at that time. */
export interface TimelineBin { fromMs: number; toMs: number; calls: number; compaction: boolean; firstCallIdx: number | null }

export function timeline(events: ConversationEvent[], range: { fromMs: number; toMs: number }, bins: number): TimelineBin[] {
  const span = Math.max(1, range.toMs - range.fromMs);
  const width = span / Math.max(1, bins);
  const out: TimelineBin[] = Array.from({ length: Math.max(1, bins) }, (_, i) => ({ fromMs: range.fromMs + i * width, toMs: range.fromMs + (i + 1) * width, calls: 0, compaction: false, firstCallIdx: null }));
  const at = (t: number) => Math.min(out.length - 1, Math.max(0, Math.floor((t - range.fromMs) / width)));
  for (const e of events) {
    if (e.kind === "call") {
      const b = out[at(e.tMs)];
      b.calls += 1;
      if (b.firstCallIdx === null) b.firstCallIdx = e.refIdx;
    } else if (e.kind === "compaction_start" || e.kind === "compaction_end") out[at(e.tMs)].compaction = true;
  }
  return out;
}

/** A cut text, shown: the whole, or head … tail. */
export const cutText = (c: CutText | undefined | null): string => (c?.text !== undefined ? c.text : c ? `${c.head ?? ""} … ${c.tail ?? ""}` : "");

// ---------- searching the conversation's text ----------

const cutToText = (c: unknown): string => {
  if (!c || typeof c !== "object") return "";
  const v = c as CutText;
  return v.text !== undefined ? v.text : `${v.head ?? ""}\n…\n${v.tail ?? ""}`;
};

/** The text an event carries, as the page shows it: a call's thinking and text, a tool's argument and result, a message. */
export function eventText(e: ConversationEvent): string {
  switch (e.kind) {
    case "call": return [cutToText(e.thinking), cutToText(e.textBody)].filter(Boolean).join("\n");
    case "tool_start": return String(e.arg ?? "");
    case "tool_end": return cutToText(e.result);
    case "msg": return cutToText(e.textBody);
    default: return "";
  }
}

/** Whether the event's text holds the query (case-insensitive); an empty query matches everything. */
export function matchesQuery(e: ConversationEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || eventText(e).toLowerCase().includes(q);
}

/** The text split into runs, the ones that are the query marked, for highlighting. */
export function splitHighlights(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const j = lower.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) out.push({ text: text.slice(i, j), hit: false });
    out.push({ text: text.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

/** A cell shows this many lines before it is folded behind a + button. */
export const CLAMP_LINES = 5;
/** A text this long is folded whatever its line count (a cell is about this wide in characters, times the lines). */
export const CLAMP_CHARS = 400;
export const needsClamp = (text: string) => text.split("\n").length > CLAMP_LINES || text.length > CLAMP_CHARS;

// ---------- turns: the conversation as a reader follows it ----------

/** The kinds a reader can show or hide; a bar's part names one of them. */
export type TurnKind = "call" | "tool" | "msg" | "compaction" | "wait" | "request" | "condition";
export const TURN_KINDS: { id: TurnKind; name: string }[] = [
  { id: "call", name: "Model calls" }, { id: "tool", name: "Tool calls" }, { id: "compaction", name: "Compactions" }, { id: "wait", name: "Waits" },
  { id: "msg", name: "Messages" }, { id: "request", name: "Engine requests" }, { id: "condition", name: "Machine readings" },
];
/** Where each part of a time bar lands: the kind it shows alone. */
export const SEGMENT_KIND: Record<Seg, TurnKind> = {
  prefill: "call", decode: "call", modelUnsplit: "call", other: "call", compaction: "compaction", tools: "tool", betweenSessions: "wait",
};

export interface ToolTurn { idx: number; start: ConversationEvent; end: ConversationEvent | null }

/** One turn: a model call with the tools it called and the engine's request for it; or a message, a compaction
 * (its start and end together), a wait, an engine request no call matched, a machine reading, or a tool no call owns. */
export interface Turn {
  kind: TurnKind;
  /** The event the turn is: the call, the message, the compaction's start, the wait, the request, the reading, the tool's start. */
  event: ConversationEvent;
  tMs: number;
  tools: ToolTurn[];
  request: ConversationEvent | null;
  end: ConversationEvent | null;
  /** A model call's index (its page's address), when the turn is one. */
  callIdx: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** The events as turns, in time order. A call's tools and request find it whatever their order in the stream (a
 * request placed late has an earlier time than the call it answers). */
export function turns(events: ConversationEvent[]): Turn[] {
  const sorted = [...events].sort((a, b) => a.tMs - b.tMs || a.ord - b.ord);
  const calls = new Map<number, Turn>();
  const out: Turn[] = [];
  const own = (kind: TurnKind, e: ConversationEvent): Turn => ({ kind, event: e, tMs: e.tMs, tools: [], request: null, end: null, callIdx: null });
  // Pass 1: every turn that stands by itself, calls first so their tools and requests can find them.
  for (const e of sorted) {
    if (e.kind === "call") { const t = { ...own("call", e), callIdx: num(e.refIdx) }; if (t.callIdx !== null) calls.set(t.callIdx, t); out.push(t); }
    else if (e.kind === "compaction_start") out.push(own("compaction", e));
    else if (e.kind === "between_sessions") out.push(own("wait", e));
    else if (e.kind === "msg") out.push(own("msg", e));
    else if (e.kind === "condition") out.push(own("condition", e));
  }
  // Pass 2: what belongs to a turn, or stands alone when nothing owns it.
  const tools = new Map<number, ToolTurn>();
  const ends = new Map<number, ConversationEvent>();
  const compactions = new Map<number, Turn>(out.filter((t) => t.kind === "compaction").map((t) => [num(t.event.refIdx) ?? -1, t]));
  for (const e of sorted) {
    if (e.kind === "tool_start") {
      const idx = num(e.refIdx) ?? -1;
      const t: ToolTurn = { idx, start: e, end: ends.get(idx) ?? null };
      tools.set(idx, t);
      const owner = num(e.callIdx);
      const call = owner !== null ? calls.get(owner) : undefined;
      if (call) call.tools.push(t); else out.push({ ...own("tool", e), tools: [t], callIdx: owner });
    } else if (e.kind === "tool_end") {
      const idx = num(e.refIdx) ?? -1;
      const t = tools.get(idx);
      if (t) t.end = e; else ends.set(idx, e);
    } else if (e.kind === "request") {
      const owner = num(e.callIdx);
      const call = owner !== null ? calls.get(owner) : undefined;
      if (call) call.request = e; else out.push({ ...own("request", e), callIdx: owner });
    } else if (e.kind === "compaction_end") {
      const t = compactions.get(num(e.refIdx) ?? -1);
      if (t) t.end = e; else out.push({ ...own("compaction", e), end: e });
    }
  }
  out.sort((a, b) => a.tMs - b.tMs || a.event.ord - b.event.ord);
  return out;
}

/** The text a turn holds: the call's words and thinking, its tools' arguments and results, a message. */
export function turnText(t: Turn): string {
  const parts = [eventText(t.event), ...t.tools.flatMap((x) => [eventText(x.start), x.end ? eventText(x.end) : ""])];
  return parts.filter(Boolean).join("\n");
}

export interface TurnFilter { kinds: Set<TurnKind>; query: string; range: [number, number] | null }

/** Whether a turn is shown: its kind on, in the range, and holding the text (its tools count for a call). */
export function turnShown(t: Turn, f: TurnFilter): boolean {
  if (f.range && (t.tMs < f.range[0] || t.tMs >= f.range[1])) return false;
  const q = f.query.trim().toLowerCase();
  const textOk = q === "" || turnText(t).toLowerCase().includes(q);
  if (!textOk) return false;
  if (f.kinds.has(t.kind)) return true;
  // A call hidden but its tools shown: the tools stand as rows of their own (the page does that split).
  return t.kind === "call" && f.kinds.has("tool") && t.tools.length > 0;
}

/** `?kind=tool`: only that kind on; absent: every kind. */
export function kindsFromParam(kind: string | undefined): Set<TurnKind> {
  const all = new Set(TURN_KINDS.map((k) => k.id));
  if (!kind) return all;
  const one = TURN_KINDS.find((k) => k.id === kind);
  return one ? new Set([one.id]) : all;
}

/** `m:ss` past a minute, `s.s s` under it: a moment of the story. */
export function clock(ms: number, fromMs: number): string {
  const s = Math.max(0, ms - fromMs) / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------- the strip: where the model worked, where tools ran, where it compacted ----------

export interface StripMark { kind: "call" | "tool" | "compaction"; x0: number; x1: number; h: number; turn: number; label: string }

/** The strip's marks in 0..1 of the width and height: a call as a bar at its end whose height is its output (or its
 * thinking) against the story's largest; a tool as a band from its start to its end; a compaction as a line. */
export function strip(all: Turn[], range: { fromMs: number; toMs: number }): StripMark[] {
  const span = Math.max(1, range.toMs - range.fromMs);
  const x = (t: number) => Math.min(1, Math.max(0, (t - range.fromMs) / span));
  const size = (t: Turn) => (typeof t.event.outTok === "number" ? t.event.outTok : typeof t.event.think === "number" ? t.event.think : 1);
  const biggest = Math.max(1, ...all.filter((t) => t.kind === "call").map(size));
  const out: StripMark[] = [];
  all.forEach((t, i) => {
    if (t.kind === "call") {
      const sent = typeof t.event.sentMs === "number" ? t.event.sentMs : t.tMs;
      out.push({ kind: "call", x0: x(sent), x1: x(t.tMs), h: Math.max(0.08, Math.sqrt(size(t) / biggest)), turn: i, label: `call ${(t.callIdx ?? 0) + 1} at ${clock(t.tMs, range.fromMs)}` });
      for (const tool of t.tools) {
        const end = tool.end ? tool.end.tMs : range.toMs;
        out.push({ kind: "tool", x0: x(tool.start.tMs), x1: x(end), h: 0.18, turn: i, label: `${String(tool.start.name ?? "tool")} at ${clock(tool.start.tMs, range.fromMs)}` });
      }
    } else if (t.kind === "tool") {
      const tool = t.tools[0];
      out.push({ kind: "tool", x0: x(tool.start.tMs), x1: x(tool.end ? tool.end.tMs : range.toMs), h: 0.18, turn: i, label: `${String(tool.start.name ?? "tool")} at ${clock(t.tMs, range.fromMs)}` });
    } else if (t.kind === "compaction") {
      out.push({ kind: "compaction", x0: x(t.tMs), x1: x(t.end ? t.end.tMs : t.tMs), h: 1, turn: i, label: `compaction at ${clock(t.tMs, range.fromMs)}` });
    }
  });
  return out;
}

/** The turn nearest a moment (by its own time), for a click on the strip. */
export function nearestTurn(all: Turn[], tMs: number): number | null {
  let best: number | null = null;
  let d = Infinity;
  all.forEach((t, i) => { const dd = Math.abs(t.tMs - tMs); if (dd < d) { d = dd; best = i; } });
  return best;
}
