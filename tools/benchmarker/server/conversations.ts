// The conversations the page shows come from the warehouse through dbench's conversation API, which this server
// proxies as /api/conversations/… (never reading the database itself). In fixture mode the same routes are served
// from the fixture's events in memory, with the same paging rules, so the tests see what the API would give.
import type { Conversation, ConversationEvent, EventsPage } from "../shared/conversation.ts";
import type { ActivityData } from "../shared/activityView.ts";
import { EVENTS_PAGE_MAX } from "../shared/conversation.ts";

export interface Available { ids: string[]; complete: string[] }

export interface EventsQuery { fromMs?: number; toMs?: number; cursor?: string; after?: string; limit?: number }

/** What the page can ask about conversations. Null means not available, whatever the reason. */
export interface ConversationStore {
  available(): Promise<Available | null>;
  conversation(id: string): Promise<Conversation | null>;
  events(id: string, q: EventsQuery): Promise<EventsPage | { error: string } | null>;
  call(id: string, idx: number): Promise<Record<string, unknown> | null>;
  tool(id: string, idx: number): Promise<Record<string, unknown> | null>;
  /** Thinking by activity class, per story run (shared/activityView.ts). Null when the API can't be reached. */
  activity(): Promise<ActivityData | null>;
}

const FETCH_TIMEOUT_MS = 10_000;
const EVENTS_PAGE_DEFAULT = 200;

async function getJson<T>(url: string): Promise<T | { error: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (r.status === 400) return (await r.json()) as { error: string };
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const isError = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

/** The real store: dbench's conversation API at `base` (http://127.0.0.1:7761). */
export function proxyStore(base: string): ConversationStore {
  const url = (path: string) => `${base.replace(/\/$/, "")}/v1/conversations${path}`;
  const plain = async <T,>(path: string): Promise<T | null> => { const v = await getJson<T>(url(path)); return isError(v) ? null : v; };
  return {
    available: () => plain<Available>(""),
    conversation: (id) => plain<Conversation>(`/${encodeURIComponent(id)}`),
    events: (id, q) => {
      const params = new URLSearchParams();
      if (q.fromMs !== undefined) params.set("fromMs", String(q.fromMs));
      if (q.toMs !== undefined) params.set("toMs", String(q.toMs));
      if (q.cursor !== undefined) params.set("cursor", q.cursor);
      if (q.after !== undefined) params.set("after", q.after);
      if (q.limit !== undefined) params.set("limit", String(q.limit));
      const qs = params.toString();
      return getJson<EventsPage>(url(`/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ""}`));
    },
    call: (id, idx) => plain(`/${encodeURIComponent(id)}/calls/${idx}`),
    tool: (id, idx) => plain(`/${encodeURIComponent(id)}/tools/${idx}`),
    activity: async () => { const v = await getJson<ActivityData>(`${base.replace(/\/$/, "")}/v1/activity`); return isError(v) ? null : v; },
  };
}

/** A fixture's conversations: `{ [storyRunId]: { fmt, complete, node, events: [...], calls?: {...}, tools?: {...} } }`.
 * Events need ord, tMs, kind, refIdx and their payload fields; the cursor is made here as the API makes it. */
export interface FixtureConversation {
  fmt?: string | null;
  complete?: boolean;
  node?: string | null;
  events: Omit<ConversationEvent, "cursor">[];
  calls?: Record<string, Record<string, unknown>>;
  tools?: Record<string, Record<string, unknown>>;
}

export const cursorOf = (e: { tMs: number; ord: number }) => `${e.tMs}:${e.ord}`;
export function parseCursor(s: string): [number, number] | null {
  const m = /^(-?\d+):(-?\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const byTime = (a: ConversationEvent, b: ConversationEvent) => a.tMs - b.tMs || a.ord - b.ord;
const byOrd = (a: ConversationEvent, b: ConversationEvent) => a.ord - b.ord;

/** The in-memory store for tests, with the API's paging rules. `append` adds events to a story (the test reset's
 * `appendEvents`), each with the next ord, so the open-ended form can be seen to pick them up. */
export function fixtureStore(data: Record<string, FixtureConversation>, activity: ActivityData | null = null): ConversationStore & { append(id: string, events: Omit<ConversationEvent, "cursor" | "ord">[]): void } {
  const stories = new Map<string, FixtureConversation & { events: ConversationEvent[] }>();
  for (const [id, c] of Object.entries(data)) stories.set(id, { ...c, events: c.events.map((e) => ({ ...e, cursor: cursorOf(e) })) });
  const range = (evs: ConversationEvent[]) => ({ fromMs: Math.min(...evs.map((e) => e.tMs)), toMs: Math.max(...evs.map((e) => e.tMs)) + 1 });
  const count = (evs: ConversationEvent[], kind: string) => evs.filter((e) => e.kind === kind).length;
  return {
    async available() {
      const ids = [...stories.entries()].filter(([, c]) => c.events.length).map(([id]) => id).sort();
      return { ids, complete: ids.filter((id) => stories.get(id)!.complete ?? true) };
    },
    async conversation(id) {
      const c = stories.get(id);
      if (!c || !c.events.length) return null;
      const evs = [...c.events].sort(byOrd);
      return {
        id, fmt: c.fmt ?? null, complete: c.complete ?? true, node: c.node ?? null, range: range(evs), latest: cursorOf(evs.at(-1)!), events: evs.length,
        counts: { calls: count(evs, "call"), toolCalls: count(evs, "tool_start"), msgs: count(evs, "msg"), compactions: count(evs, "compaction_start"), requests: count(evs, "request"), conditions: count(evs, "condition") },
      };
    },
    async events(id, q) {
      const limit = q.limit ?? EVENTS_PAGE_DEFAULT;
      if (!(limit >= 1 && limit <= EVENTS_PAGE_MAX)) return { error: `limit is 1..=${EVENTS_PAGE_MAX}` };
      const c = stories.get(id);
      if (!c || !c.events.length) return null;
      const r = range(c.events);
      if (q.after !== undefined) {
        const afterOrd = q.after === "0" ? -1 : parseCursor(q.after)?.[1];
        if (afterOrd === undefined) return { error: "after is a cursor, or 0" };
        const page = [...c.events].sort(byOrd).filter((e) => e.ord > afterOrd).slice(0, limit);
        return { events: page, nextCursor: page.length ? cursorOf(page.at(-1)!) : q.after, range: r };
      }
      const cursor = q.cursor === undefined ? null : parseCursor(q.cursor);
      if (q.cursor !== undefined && !cursor) return { error: "cursor is not one this API gave" };
      const [fromMs, toMs] = [q.fromMs ?? -Infinity, q.toMs ?? Infinity];
      const page = [...c.events].sort(byTime)
        .filter((e) => e.tMs >= fromMs && e.tMs < toMs && (!cursor || e.tMs > cursor[0] || (e.tMs === cursor[0] && e.ord > cursor[1])))
        .slice(0, limit);
      return { events: page, nextCursor: page.length === limit ? cursorOf(page.at(-1)!) : null, range: r };
    },
    async call(id, idx) { return stories.get(id)?.calls?.[String(idx)] ?? null; },
    async tool(id, idx) { return stories.get(id)?.tools?.[String(idx)] ?? null; },
    async activity() { return activity; },
    append(id, events) {
      const c = stories.get(id) ?? { events: [] };
      let ord = Math.max(-1, ...c.events.map((e) => e.ord));
      for (const e of events) { ord += 1; c.events.push({ ...e, ord, cursor: cursorOf({ tMs: e.tMs, ord }) }); }
      stories.set(id, c);
    },
  };
}
