// LeadScore reads two views of one run: leadScore (what to lead with) and scoreOfRecord (why there is no score, or the
// record to link). They are built from the same data and cannot disagree for a real run, but LeadScore still handles the
// case where they do: it must fall back to "pending" for the reason, and show a record's score without a link.
// Reached here by making leadScore answer differently from scoreOfRecord.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row, State } from "../../../shared/types.ts";
import type { LeadScore } from "../../../shared/runView.ts";

const PASSED = 7;
const TOTAL = 9;
const forced = vi.hoisted(() => ({ lead: null as null | LeadScore }));

vi.mock("../../../shared/runView.ts", async (importActual) => {
  const actual = await importActual<typeof import("../../../shared/runView.ts")>();
  return { ...actual, leadScore: (run: Row) => forced.lead ?? actual.leadScore(run) };
});

const { RunHeader } = await import("./RunHeader.tsx");

const finishedWithNoScoreOfRecord = { pack: "vidi", stack: "s", runId: "r1", dir: "d", machine: "m", host: "h", label: "l", suite: "vidi-v2", status: "finished", state: "finished",
  stateAt: "2026-09-30T15:28:00Z", statusNote: "", stories: [], scores: {}, interventions: [], jobs: [], live: null, judgeReady: false, knownGood: false,
  storiesWorking: { working: 0, scope: 0, squares: [] } } as unknown as Row;
const state = { web: "https://example.invalid/r", branch: "main", judgeUrl: "" } as State;

afterEach(() => { forced.lead = null; });

describe("LeadScore when leadScore and scoreOfRecord disagree", () => {
  it("a lead of none beside a scored record: the reason falls back to pending", () => {
    // The real run is finished with a score of record (so scoreOfRecord says "scored"), yet the lead is forced to none.
    forced.lead = { kind: "none" };
    const scored = { ...finishedWithNoScoreOfRecord, scores: { "vidi-v2": { passed: PASSED, total: TOTAL, flaky: 0, at: "t" } } } as Row;
    const html = renderToStaticMarkup(<RunHeader run={scored} state={state} />);
    expect(html).toContain('data-lead="none"');
    expect(html).toContain('<span class="na" data-reason="pending"');
  });
  it("a record lead beside a run with no score of record: the score shows, without a link", () => {
    forced.lead = { kind: "record", passed: PASSED, total: TOTAL, version: "vidi-v2", currentSuite: true };
    const html = renderToStaticMarkup(<RunHeader run={finishedWithNoScoreOfRecord} state={state} />);
    expect(html).toContain('data-lead="record"');
    expect(html).toContain(`>${PASSED}</strong><span class="record-of">/${TOTAL}</span>`);
    expect(html).not.toContain("per-story.md");
  });
});
