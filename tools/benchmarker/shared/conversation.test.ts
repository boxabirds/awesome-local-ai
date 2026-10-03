import { describe, expect, it } from "vitest";
import { cutText, EventStore, SEGMENT_ANCHOR, storyRunId, timeline, type ConversationEvent } from "./conversation.ts";
import { SEGMENTS } from "./runView.ts";

const ev = (ord: number, tMs: number, kind = "call", refIdx = ord): ConversationEvent => ({ ord, tMs, kind, refIdx, cursor: `${tMs}:${ord}` });

describe("ids and anchors", () => {
  it("a story run's id pads the story number", () => {
    expect(storyRunId("combinations/x/benchmarks/vidi/v2-r1", "3")).toBe("combinations/x/benchmarks/vidi/v2-r1/stories/03");
    expect(storyRunId("benchmarks/reference/vidi/opus-5.5/run-9", "12")).toBe("benchmarks/reference/vidi/opus-5.5/run-9/stories/12");
  });
  it("every part of a time bar leads somewhere on the conversation page", () => {
    for (const s of SEGMENTS) expect(SEGMENT_ANCHOR[s.seg], s.seg).toBeTruthy();
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
