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

/** The sections of the conversation page a bar's part leads to. */
export type ConversationAnchor = "calls" | "tools" | "compactions" | "sessions" | "requests" | "messages" | "conditions";

/** Where each part of a time bar lands on the conversation page. */
export const SEGMENT_ANCHOR: Record<Seg, ConversationAnchor> = {
  prefill: "calls", decode: "calls", modelUnsplit: "calls", other: "calls", compaction: "compactions", tools: "tools", betweenSessions: "sessions",
};

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
