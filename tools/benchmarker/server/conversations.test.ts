// The fixture store has the API's paging rules; the proxy passes the API through. MECE by what is asked: the list,
// one conversation, the two event forms and their refusals, one call, one tool; and by what the store holds: a story
// with events, one with none, one unknown.
import { describe, expect, it } from "vitest";
import { cursorOf, fixtureStore, parseCursor, proxyStore } from "./conversations.ts";

const EV = (ord: number, tMs: number, kind = "call") => ({ ord, tMs, kind, refIdx: ord, idx: ord });
const data = {
  a: { fmt: "pi", complete: true, events: [EV(0, 10), EV(1, 20, "tool_start"), EV(2, 20, "tool_end"), EV(3, 30), EV(4, 15, "request")], calls: { "0": { idx: 0 } }, tools: { "1": { idx: 1 } } },
  empty: { events: [] },
  growing: { complete: false, events: [EV(0, 5)] },
};
const store = () => fixtureStore(JSON.parse(JSON.stringify(data)));

describe("the list", () => {
  it("names every story with events, and which are complete", async () => {
    expect(await store().available()).toEqual({ ids: ["a", "growing"], complete: ["a"] });
  });
});

describe("one conversation", () => {
  it("has its range (half-open), counts, latest cursor and completeness", async () => {
    const c = (await store().conversation("a"))!;
    expect(c.range).toEqual({ fromMs: 10, toMs: 31 });
    expect(c.latest).toBe("15:4");
    expect(c.events).toBe(5);
    expect(c.counts).toEqual({ calls: 2, toolCalls: 1, msgs: 0, compactions: 0, requests: 1, conditions: 0 });
    expect(c.complete).toBe(true);
    expect((await store().conversation("growing"))!.complete).toBe(false);
  });
  it("is null for a story with no events or none at all", async () => {
    expect(await store().conversation("empty")).toBeNull();
    expect(await store().conversation("nope")).toBeNull();
  });
});

describe("the time-range form", () => {
  it("pages in (time, ord) order, contiguous, nextCursor null once exhausted", async () => {
    const s = store();
    const p1 = (await s.events("a", { limit: 2 })) as { events: { ord: number }[]; nextCursor: string | null };
    expect(p1.events.map((e) => e.ord)).toEqual([0, 4]);
    expect(p1.nextCursor).toBe("15:4");
    const p2 = (await s.events("a", { limit: 2, cursor: p1.nextCursor! })) as typeof p1;
    expect(p2.events.map((e) => e.ord)).toEqual([1, 2]);
    const p3 = (await s.events("a", { limit: 2, cursor: p2.nextCursor! })) as typeof p1;
    expect(p3.events.map((e) => e.ord)).toEqual([3]);
    expect(p3.nextCursor).toBeNull();
  });
  it("is half-open on toMs and inclusive on fromMs", async () => {
    const got = (await store().events("a", { fromMs: 15, toMs: 20 })) as { events: { ord: number }[] };
    expect(got.events.map((e) => e.ord)).toEqual([4]);
  });
  it("an exact page says there may be more, and the next page is empty with no cursor", async () => {
    const s = store();
    const p1 = (await s.events("a", { limit: 5 })) as { events: unknown[]; nextCursor: string | null };
    expect(p1.events).toHaveLength(5);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await s.events("a", { limit: 5, cursor: p1.nextCursor! })) as typeof p1;
    expect(p2).toMatchObject({ events: [], nextCursor: null });
  });
});

describe("the open-ended form", () => {
  it("after=0 is everything by ord; after=<latest> is nothing, with the same cursor", async () => {
    const s = store();
    const all = (await s.events("a", { after: "0" })) as { events: { ord: number }[]; nextCursor: string };
    expect(all.events.map((e) => e.ord)).toEqual([0, 1, 2, 3, 4]);
    expect(all.nextCursor).toBe("15:4");
    const none = (await s.events("a", { after: all.nextCursor })) as typeof all;
    expect(none).toMatchObject({ events: [], nextCursor: "15:4" });
  });
  it("sees what is appended, each with the next ord", async () => {
    const s = store();
    s.append("a", [{ tMs: 40, kind: "call", refIdx: 5 }]);
    const got = (await s.events("a", { after: "15:4" })) as { events: { ord: number; cursor: string }[] };
    expect(got.events.map((e) => [e.ord, e.cursor])).toEqual([[5, "40:5"]]);
  });
});

describe("refusals and the not-available case", () => {
  it("a bad limit, cursor or after is an error; an unknown story is null", async () => {
    const s = store();
    expect(await s.events("a", { limit: 0 })).toEqual({ error: "limit is 1..=500" });
    expect(await s.events("a", { limit: 501 })).toEqual({ error: "limit is 1..=500" });
    expect(await s.events("a", { cursor: "garbage" })).toEqual({ error: "cursor is not one this API gave" });
    expect(await s.events("a", { after: "garbage" })).toEqual({ error: "after is a cursor, or 0" });
    expect(await s.events("nope", {})).toBeNull();
    expect(await s.events("empty", {})).toBeNull();
  });
  it("one call and one tool in full, null when there is none", async () => {
    const s = store();
    expect(await s.call("a", 0)).toEqual({ idx: 0 });
    expect(await s.tool("a", 1)).toEqual({ idx: 1 });
    expect(await s.call("a", 9)).toBeNull();
    expect(await s.tool("nope", 0)).toBeNull();
  });
});

describe("cursors", () => {
  it("round-trip", () => {
    expect(cursorOf({ tMs: 15, ord: 4 })).toBe("15:4");
    expect(parseCursor("15:4")).toEqual([15, 4]);
    expect(parseCursor("x")).toBeNull();
  });
});

describe("the proxy", () => {
  it("treats a service it can't reach as not available: null, never an error", async () => {
    const p = proxyStore("http://127.0.0.1:1");
    expect(await p.available()).toBeNull();
    expect(await p.conversation("a")).toBeNull();
    expect(await p.events("a", { limit: 3 })).toBeNull();
    expect(await p.call("a", 0)).toBeNull();
  });
});
