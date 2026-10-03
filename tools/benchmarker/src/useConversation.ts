// One story run's conversation, as the page keeps it: the summary, then the events backfilled page by page over the
// whole span (the time-range form), then whatever arrives after the latest cursor, asked for every few seconds (the
// open-ended form) whatever the story's status: a finished story simply returns nothing new. Not available (404, or
// the server unreachable) is null, never an error state with a reason.
import { useEffect, useRef, useState } from "react";
import { EVENTS_PAGE_MAX, EventStore, FOLLOW_POLL_MS, type Conversation, type ConversationEvent, type EventsPage } from "../shared/conversation.ts";

export interface ConversationState {
  /** Null while loading, false when not available, else the summary. */
  summary: Conversation | null | false;
  events: ConversationEvent[];
  /** The backfill is done: every event of the span known at the start is here. */
  backfilled: boolean;
  /** The latest cursor the page has asked after. */
  latest: string | null;
  /** How many times the open-ended form has answered. */
  polls: number;
}

const api = (id: string, path = "") => `/api/conversations/${encodeURIComponent(id)}${path}`;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const EMPTY: ConversationState = { summary: null, events: [], backfilled: false, latest: null, polls: 0 };

export function useConversation(id: string | null): ConversationState {
  const [state, setState] = useState<ConversationState>(EMPTY);
  const store = useRef(new EventStore());

  useEffect(() => {
    store.current = new EventStore();
    setState(EMPTY);
    if (!id) {
      setState({ ...EMPTY, summary: false, backfilled: true });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (patch: Partial<ConversationState>) => {
      if (!stopped) setState((s) => ({ ...s, ...patch, events: store.current.all(), latest: store.current.latest }));
    };
    const follow = async () => {
      if (stopped) return;
      const after = store.current.latest ?? "0";
      const page = await getJson<EventsPage>(api(id, `/events?after=${encodeURIComponent(after)}&limit=${EVENTS_PAGE_MAX}`));
      if (page) store.current.add(page.events);
      if (!stopped) setState((s) => ({ ...s, polls: s.polls + 1, events: store.current.all(), latest: store.current.latest }));
      timer = setTimeout(() => void follow(), FOLLOW_POLL_MS);
    };
    (async () => {
      const summary = await getJson<Conversation>(api(id));
      if (stopped) return;
      if (!summary) { publish({ summary: false, backfilled: true }); return; }
      publish({ summary });
      // Backfill: the span as it was when the page opened, page by page, contiguous by the cursor.
      let cursor: string | null = null;
      do {
        const q = `/events?fromMs=${summary.range.fromMs}&toMs=${summary.range.toMs}&limit=${EVENTS_PAGE_MAX}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const page: EventsPage | null = await getJson<EventsPage>(api(id, q));
        if (!page || stopped) break;
        store.current.add(page.events);
        publish({});
        cursor = page.nextCursor;
      } while (cursor);
      // Follow from the summary's latest cursor when the backfill found nothing newer, so nothing is missed.
      if (!store.current.latest) store.current.latest = summary.latest;
      publish({ backfilled: true });
      void follow();
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [id]);

  return state;
}

/** One model call, or one tool call, in full (the call page). Null while loading, false when not available. */
export function useInFull<T>(id: string | null, path: string | null): T | null | false {
  const [v, setV] = useState<T | null | false>(null);
  useEffect(() => {
    setV(null);
    if (!id || !path) { setV(false); return; }
    let stopped = false;
    void getJson<T>(api(id, path)).then((got) => { if (!stopped) setV(got ?? false); });
    return () => { stopped = true; };
  }, [id, path]);
  return v;
}
