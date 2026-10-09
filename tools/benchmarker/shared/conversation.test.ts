import { describe, expect, it } from "vitest";
import { cutText, eventText, thinkingWithheld, EventStore, matchesQuery, needsClamp, SEGMENT_KIND, splitHighlights, storyRunId, timeline, type ConversationEvent } from "./conversation.ts";
import { SEGMENTS } from "./runView.ts";

const ev = (ord: number, tMs: number, kind = "call", refIdx = ord): ConversationEvent => ({ ord, tMs, kind, refIdx, cursor: `${tMs}:${ord}` });

describe("ids and anchors", () => {
  it("a story run's id pads the story number", () => {
    expect(storyRunId("combinations/x/benchmarks/vidi/v2-r1", "3")).toBe("combinations/x/benchmarks/vidi/v2-r1/stories/03");
    expect(storyRunId("benchmarks/reference/vidi/opus-5.5/run-9", "12")).toBe("benchmarks/reference/vidi/opus-5.5/run-9/stories/12");
  });
  it("every part of a time bar names a kind of turn", () => {
    for (const s of SEGMENTS) expect(SEGMENT_KIND[s.seg], s.seg).toBeTruthy();
  });
});

describe("the page's event store", () => {
  it("merges pages and follow-ups without duplicates, in (time, ord) order, and knows the latest cursor", () => {
    const s = new EventStore();
    expect(s.add([ev(0, 10), ev(1, 20)])).toBe(2);
    expect(s.add([ev(1, 20), ev(2, 15)])).toBe(1);
    expect(s.all().map((e) => e.ord)).toEqual([0, 2, 1]);
    expect(s.latest).toBe("15:2");
    expect(s.ofKind("call")).toHaveLength(3);
    expect(s.size).toBe(3);
  });
});

describe("the timeline", () => {
  it("bins calls over the span and marks compactions", () => {
    const bins = timeline([ev(0, 0), ev(1, 10), ev(2, 90), ev(3, 55, "compaction_start", 0)], { fromMs: 0, toMs: 100 }, 4);
    expect(bins.map((b) => b.calls)).toEqual([2, 0, 0, 1]);
    expect(bins.map((b) => b.compaction)).toEqual([false, false, true, false]);
    expect(bins[0].firstCallIdx).toBe(0);
    expect(bins[3].firstCallIdx).toBe(2);
  });
  it("is one bin for an empty span", () => {
    expect(timeline([], { fromMs: 5, toMs: 5 }, 3)).toHaveLength(3);
  });
});

describe("cut text", () => {
  it("shows the whole, or head … tail", () => {
    expect(cutText({ text: "all" })).toBe("all");
    expect(cutText({ head: "a", tail: "z", chars: 9000 })).toBe("a … z");
    expect(cutText(null)).toBe("");
  });
});

describe("searching the conversation", () => {
  const call = (thinking: string, text: string) => ({ ord: 0, tMs: 0, kind: "call", refIdx: 0, cursor: "0:0", thinking: { text: thinking }, textBody: { text } });
  it("an event's text is what the page shows of it, cut texts included", () => {
    expect(eventText(call("I think", "I say"))).toBe("I think\nI say");
    expect(eventText({ ord: 1, tMs: 0, kind: "tool_end", refIdx: 0, cursor: "0:1", result: { head: "a", tail: "z", chars: 9000 } })).toBe("a\n…\nz");
    expect(eventText({ ord: 2, tMs: 0, kind: "tool_start", refIdx: 0, cursor: "0:2", arg: "npm test" })).toBe("npm test");
    expect(eventText({ ord: 3, tMs: 0, kind: "condition", refIdx: 0, cursor: "0:3" })).toBe("");
  });
  it("matches case-insensitively, and everything on an empty query", () => {
    expect(matchesQuery(call("The Harness said", ""), "harness")).toBe(true);
    expect(matchesQuery(call("nothing", "here"), "harness")).toBe(false);
    expect(matchesQuery(call("nothing", "here"), "  ")).toBe(true);
  });
  it("splits a text into runs with the hits marked", () => {
    expect(splitHighlights("a Harness and a harness", "harness")).toEqual([
      { text: "a ", hit: false }, { text: "Harness", hit: true }, { text: " and a ", hit: false }, { text: "harness", hit: true },
    ]);
    expect(splitHighlights("plain", "")).toEqual([{ text: "plain", hit: false }]);
    expect(splitHighlights("", "x")).toEqual([{ text: "", hit: false }]);
  });
  it("folds a cell past five lines or a long text", () => {
    expect(needsClamp("1\n2\n3\n4\n5")).toBe(false);
    expect(needsClamp("1\n2\n3\n4\n5\n6")).toBe(true);
    expect(needsClamp("x".repeat(401))).toBe(true);
  });
});

// The page's choices in its address (?kind=call,tool&q=…&span=a-b): what is left out and what is read back.
describe("the conversation page's choices in the address", () => {
  it("kinds: every kind is no parameter; a subset is the ids in the chips' order; an unknown id is ignored, and only unknown ids is every kind", async () => {
    const { kindsFromParam, kindsToParam, TURN_KINDS } = await import("./conversation.ts");
    const all = new Set(TURN_KINDS.map((k) => k.id));
    expect(kindsToParam(all)).toBeUndefined();
    expect(kindsToParam(new Set(["tool", "call"]))).toBe("call,tool");
    expect([...kindsFromParam("call,tool")]).toEqual(["call", "tool"]);
    expect([...kindsFromParam("tool")]).toEqual(["tool"]);
    expect([...kindsFromParam("tool,nonsense")]).toEqual(["tool"]);
    expect(kindsFromParam("nonsense")).toEqual(all);
    expect(kindsFromParam(undefined)).toEqual(all);
    expect(kindsFromParam(kindsToParam(new Set(["msg", "wait"])))).toEqual(new Set(["wait", "msg"]));
  });
  it("span: whole milliseconds from the story's start, a-b with a < b; anything else is no span", async () => {
    const { spanFromParam, spanToParam } = await import("./conversation.ts");
    const FROM = 1_790_000_000_000;
    expect(spanToParam(null, FROM)).toBeUndefined();
    expect(spanToParam([FROM + 1200.4, FROM + 3000.6], FROM)).toBe("1200-3001");
    expect(spanFromParam("1200-3001", FROM)).toEqual([FROM + 1200, FROM + 3001]);
    expect(spanFromParam(undefined, FROM)).toBeNull();
    expect(spanFromParam("3001-1200", FROM)).toBeNull();
    expect(spanFromParam("5-5", FROM)).toBeNull();
    expect(spanFromParam("a-b", FROM)).toBeNull();
    expect(spanFromParam("1200", FROM)).toBeNull();
  });
});

// Interventions are turns of the story's conversation: something done to the run by hand or by a watchdog, at its time.
describe("interventions in the conversation", () => {
  it("is a kind the reader can show or hide, after the machine readings", async () => {
    const { TURN_KINDS } = await import("./conversation.ts");
    expect(TURN_KINDS.map((k) => k.id)).toContain("intervention");
  });
  it("an intervention event is a turn of its own, in time order among the calls", async () => {
    const { turns } = await import("./conversation.ts");
    const events = [ev(1, 1000, "call", 0), { ...ev(2, 2000, "intervention", 0), text: "a tool call silent for 600 s was interrupted" }, ev(3, 3000, "call", 1)];
    const all = turns(events);
    expect(all.map((t) => t.kind)).toEqual(["call", "intervention", "call"]);
    expect(all[1].event.text).toBe("a tool call silent for 600 s was interrupted");
  });
  it("is shown by its own kind only, and found by its text", async () => {
    const { turns, turnShown, kindsFromParam } = await import("./conversation.ts");
    const [t] = turns([{ ...ev(1, 1000, "intervention", 0), text: "paused 5 min, then resumed" }]);
    expect(turnShown(t, { kinds: kindsFromParam("intervention"), query: "", range: null })).toBe(true);
    expect(turnShown(t, { kinds: kindsFromParam("call,compaction"), query: "", range: null })).toBe(false);
    expect(turnShown(t, { kinds: kindsFromParam(undefined), query: "resumed", range: null })).toBe(true);
    expect(turnShown(t, { kinds: kindsFromParam(undefined), query: "nothing", range: null })).toBe(false);
  });
  it("the strip marks it as a line, with its time", async () => {
    const { turns, strip } = await import("./conversation.ts");
    const all = turns([{ ...ev(1, 5000, "intervention", 0), text: "x" }]);
    const marks = strip(all, { fromMs: 0, toMs: 10000 });
    expect(marks).toEqual([{ kind: "intervention", x0: 0.5, x1: 0.5, h: 1, turn: 0, label: "intervention at 5.0 s" }]);
  });
  it("events from a run's interventions: its words, its time, this story's only", async () => {
    const { interventionEvents } = await import("./conversation.ts");
    const list = [
      { at: 100, story: "2", text: "interrupted a tool call silent for 600s (no output)" },
      { at: 200, story: "3", text: "interrupted a tool call silent for 600s" },
      { at: 300, story: null, text: "RESUMED (paused 5 min)" },
    ];
    const events = interventionEvents(list, "2");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "intervention", tMs: 100_000, text: "a tool call silent for 600 s was interrupted", count: 1 });
  });
  it("the guard firing twice on one silent call is one event, at the first firing, saying how many times", async () => {
    const { interventionEvents } = await import("./conversation.ts");
    const silent = "interrupted a tool call silent for 600s (killed processes under the workspace)";
    const list = [
      { at: 1000, story: "3", text: silent }, { at: 1030, story: "3", text: silent },   // one call, interrupted twice
      { at: 2000, story: "3", text: silent },                                           // 970 s later: another call
    ];
    const events = interventionEvents(list, "3");
    expect(events.map((e) => [e.tMs, e.count, e.lastAt])).toEqual([[1_000_000, 2, 1030], [2_000_000, 1, 2000]]);
  });
  it("the tool call an intervention interrupted: open, silent long enough, and the latest such (not a killed call's ghost)", async () => {
    // The guard's kill does not always end the call in the log, so an interrupted call stays open for ever. A later
    // interrupt is about the call that started after it, not that ghost.
    const { turns, openToolAt } = await import("./conversation.ts");
    const S = 600_000;
    const all = turns([
      { ...ev(1, 1000, "tool_start", 0), name: "bash", arg: "the first, killed and never ended" },
      { ...ev(2, 601_500, "tool_start", 1), name: "bash", arg: "the second" },
      { ...ev(3, 1_300_000, "intervention", null), text: "x" },
    ]);
    expect(openToolAt(all, 601_400, S)?.start.arg).toBe("the first, killed and never ended");
    expect(openToolAt(all, 1_300_000, S)?.start.arg).toBe("the second");   // silent 698 s by then; the ghost is older
    expect(openToolAt(all, 900_000, S)?.start.arg).toBe("the first, killed and never ended"); // the second is too young
    expect(openToolAt(all, 500, S)).toBeNull();                            // nothing open yet
    // After an interrupt at 601.5 s, the call it killed is never named again, even while the log leaves it open and
    // the call that replaced it is not among the events loaded so far: no call is named rather than the wrong one.
    expect(openToolAt(all, 1_300_000, S, 601_500)).toBeNull();
  });
});

describe("whose log shows the thinking", () => {
  it("pi shows it; Claude Code and OpenCode do not, so theirs is not available rather than zero", () => {
    // 8 Oct 2026: an OpenCode story (fmt "opencode") was shown as "0 thinking" on every call, because only "claude" was withheld.
    expect(thinkingWithheld("pi")).toBe(false);
    expect(thinkingWithheld("claude")).toBe(true);
    expect(thinkingWithheld("opencode")).toBe(true);
    expect(thinkingWithheld(null)).toBe(false);
    expect(thinkingWithheld(undefined)).toBe(false);
  });
});
