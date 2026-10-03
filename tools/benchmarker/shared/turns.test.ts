import { describe, expect, it } from "vitest";
import { clock, kindsFromParam, nearestTurn, SEGMENT_KIND, strip, turnShown, turnText, turns, TURN_KINDS, type ConversationEvent } from "./conversation.ts";
import { SEGMENTS } from "./runView.ts";

const ev = (ord: number, tMs: number, kind: string, refIdx: number | null, extra: Record<string, unknown> = {}): ConversationEvent => ({ ord, tMs, kind, refIdx, cursor: `${tMs}:${ord}`, ...extra });
const story: ConversationEvent[] = [
  ev(0, 0, "msg", 0, { textBody: { text: "Go" } }),
  ev(1, 1000, "between_sessions", 0, { seconds: 2 }),
  ev(2, 5000, "call", 0, { outTok: 300, think: 10, sentMs: 3000, thinking: { text: "I think" }, textBody: { text: "I read" } }),
  ev(3, 5000, "tool_start", 0, { callIdx: 0, name: "read", arg: "spec.md" }),
  ev(4, 7000, "tool_end", 0, { callIdx: 0, name: "read", result: { text: "the spec" } }),
  ev(5, 8000, "request", 0, { callIdx: 0, promptTok: 10 }),
  ev(6, 9000, "compaction_start", 0, { reason: "context" }),
  ev(7, 10000, "compaction_end", 0, { reason: "context", seconds: 1 }),
  ev(8, 11000, "call", 1, { outTok: 900, sentMs: 10500, textBody: { text: "Done" } }),
  ev(9, 12000, "tool_start", 1, { callIdx: 7, name: "bash", arg: "ls" }),   // its call isn't in the log: a row of its own
  ev(10, 13000, "request", 1, { callIdx: null, promptTok: 5 }),           // unmatched: a row of its own
  ev(11, 14000, "condition", 0, { thermal: "nominal" }),
  ev(12, 4000, "request", 2, { callIdx: 0, promptTok: 99 }),              // late-placed, earlier in time: still call 0's
];

describe("turns", () => {
  it("groups a call with its tools and its request; the rest are turns of their own, in time order", () => {
    const t = turns(story);
    expect(t.map((x) => x.kind)).toEqual(["msg", "wait", "call", "compaction", "call", "tool", "request", "condition"]);
    const call0 = t[2];
    expect(call0.callIdx).toBe(0);
    expect(call0.tools.map((x) => [x.idx, x.end?.kind ?? null])).toEqual([[0, "tool_end"]]);
    expect(call0.request?.ord).toBe(5);   // the later-placed request wins; both belong to call 0
    expect(t[3].end?.ord).toBe(7);
    expect(t[5].tools[0].start.name).toBe("bash");
    expect(t[5].tools[0].end).toBeNull();
    expect(turnText(call0)).toBe("I think\nI read\nspec.md\nthe spec");
  });
  it("is shown by kind, text and range; a hidden call with shown tools still stands for them", () => {
    const t = turns(story);
    const all = new Set(TURN_KINDS.map((k) => k.id));
    expect(t.filter((x) => turnShown(x, { kinds: all, query: "", range: null }))).toHaveLength(8);
    expect(t.filter((x) => turnShown(x, { kinds: new Set(["call"]), query: "", range: null })).map((x) => x.kind)).toEqual(["call", "call"]);
    expect(t.filter((x) => turnShown(x, { kinds: new Set(["tool"]), query: "", range: null })).map((x) => x.kind)).toEqual(["call", "tool"]);
    expect(t.filter((x) => turnShown(x, { kinds: all, query: "spec", range: null })).map((x) => x.kind)).toEqual(["call"]);
    expect(t.filter((x) => turnShown(x, { kinds: all, query: "", range: [9000, 12000] })).map((x) => x.kind)).toEqual(["compaction", "call"]);
  });
  it("a bar's part names a kind; ?kind= turns one on, nothing turns all on", () => {
    for (const s of SEGMENTS) expect(TURN_KINDS.some((k) => k.id === SEGMENT_KIND[s.seg]), s.seg).toBe(true);
    expect([...kindsFromParam("tool")]).toEqual(["tool"]);
    expect(kindsFromParam(undefined).size).toBe(TURN_KINDS.length);
    expect(kindsFromParam("nope").size).toBe(TURN_KINDS.length);
  });
  it("a moment reads as seconds under a minute and m:ss past it", () => {
    expect(clock(4200, 0)).toBe("4.2 s");
    expect(clock(1_234_500, 0)).toBe("20:34");
    expect(clock(60_000, 0)).toBe("1:00");
  });
});

describe("the strip", () => {
  it("marks each call from its send to its end with a height by its output, each tool as a band, each compaction as a line", () => {
    const t = turns(story);
    const marks = strip(t, { fromMs: 0, toMs: 20000 });
    const call0 = marks.find((m) => m.kind === "call" && m.turn === 2)!;
    expect([call0.x0, call0.x1]).toEqual([0.15, 0.25]);
    expect(call0.h).toBeCloseTo(Math.sqrt(300 / 900));
    const big = marks.find((m) => m.kind === "call" && m.turn === 4)!;
    expect(big.h).toBe(1);
    expect(marks.filter((m) => m.kind === "tool")).toHaveLength(2);
    expect(marks.find((m) => m.kind === "tool" && m.turn === 5)!.x1).toBe(1);   // no end: to the story's end
    expect(marks.find((m) => m.kind === "compaction")!.x0).toBe(0.45);
    expect(nearestTurn(t, 5200)).toBe(2);
    expect(nearestTurn([], 1)).toBeNull();
  });
});
