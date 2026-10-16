// RunHeader's lead score (LeadScore), rendered to HTML for every kind of lead a run can have.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Row, Score, State, Story } from "../../../shared/types.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { RunHeader } from "./RunHeader.tsx";

const SUITE = "vidi-v2.0-pre1";
const OLD_SUITE = "vidi-v1.1";
const WEB = "https://github.com/example/awesome-local-ai";
const BRANCH = "main";
const DIR = "combinations/qwen/x/pi/benchmarks/vidi/v2-r1";
const PASSED = 62;
const TOTAL = 75;
const FLAKY = 3;

const score = (passed: number | null, total: number | null, flaky = 0): Score => ({ passed, total, flaky, at: "2026-09-30T18:30:00Z" });
const story = (id: string, passed: number | null, total: number | null): Story => ({
  id, title: `Story ${id}`, status: "DONE", passed, total, ownPassed: passed, ownTotal: total, storyRunId: null,
}) as Story;

const run = (over: Partial<Row> = {}): Row => ({
  pack: "vidi", stack: "qwen/x/pi", runId: "v2-r1", dir: DIR, node: "n", host: "h", machine: "m", label: "x pi", client: "pi",
  packVersion: SUITE, family: "vidi-v2", suite: SUITE, state: "finished", stateAt: "2026-09-30T15:28:00Z", status: "finished",
  storiesWorking: { working: 0, scope: 0, squares: [] }, usage: {}, statusNote: "", stories: [], rescores: [], scores: {},
  judgeReady: false, live: null, jobs: [], interventions: [], knownGood: false, ...over,
}) as Row;

const state = (over: Partial<State> = {}) => ({ web: WEB, branch: BRANCH, judgeUrl: "http://judge.invalid", ...over }) as State;
const lead = (r: Row, s: State = state()) => {
  const html = renderToStaticMarkup(<RunHeader run={r} state={s} />);
  return html.slice(html.indexOf('<div class="lead-score"'), html.indexOf("</div></div>", html.indexOf('<div class="lead-score"')));
};

describe("RunHeader lead score", () => {
  it("a finished run whose score is not in yet leads with the one word 'pending'", () => {
    const out = lead(run());
    expect(out).toContain('data-lead="none"');
    expect(out).toContain('class="na pending" data-reason="pending"');
    expect(out).toContain(`data-tip="${GLOSSARY.noScore.what}">pending</span>`);
  });
  it("a failed run with no score leads with a dash and its reason", () => {
    const out = lead(run({ status: "failed" }));
    expect(out).toContain('data-lead="none"');
    expect(out).toContain('<span class="na" data-reason="ended-early"');
    expect(out).toContain(`data-tip="${GLOSSARY.noScore.what}">—</span>`);
    expect(out).not.toContain("pending");
  });
  it("a partial rerun with no score leads with a dash and its reason", () => {
    const out = lead(run({ knownGood: true }));
    expect(out).toContain('data-reason="partial-rerun"');
  });
  it("a running run with no story scored yet leads with a dash: not finished", () => {
    const out = lead(run({ status: "running", stories: [story("1", null, null)] }));
    expect(out).toContain('data-lead="none"');
    expect(out).toContain('data-reason="not-finished"');
  });
  it("a running run leads with its latest whole-suite score so far", () => {
    const out = lead(run({ status: "running", stories: [story("1", 5, 10), story("2", 9, 20)] }));
    expect(out).toContain('data-lead="live"');
    expect(out).toContain('<strong class="record-n');
    expect(out).toContain(">9</strong><span class=\"record-of\">/20</span>");
    expect(out).toContain("held-out tests pass");
    expect(out).toContain('data-stat="liveHeldOut"');
  });
  it("a finished run leads with its score of record, linked to the per-story results", () => {
    const out = lead(run({ scores: { [SUITE]: score(PASSED, TOTAL) } }));
    expect(out).toContain('data-lead="record"');
    expect(out).toContain(`href="${WEB}/blob/${BRANCH}/${DIR}/rescore/${SUITE}/per-story.md"`);
    expect(out).toContain(`${PASSED} of ${TOTAL} held-out tests pass · per-story results`);
    expect(out).toContain(`>${PASSED}</strong><span class="record-of">/${TOTAL}</span>`);
    expect(out).not.toContain("flaky");
  });
  it("says how many of the record's tests are flaky", () => {
    const out = lead(run({ scores: { [SUITE]: score(PASSED, TOTAL, FLAKY) } }));
    expect(out).toContain(`${FLAKY} flaky`);
  });
  it("a score of record under an older suite is the one shown, and linked under that suite", () => {
    const out = lead(run({ scores: { [OLD_SUITE]: score(PASSED, TOTAL) } }));
    expect(out).toContain(`/rescore/${OLD_SUITE}/per-story.md`);
  });
  it("a record with no web address, or no directory, shows the score without a link", () => {
    for (const out of [lead(run({ scores: { [SUITE]: score(PASSED, TOTAL) } }), state({ web: null })), lead(run({ dir: null, scores: { [SUITE]: score(PASSED, TOTAL) } }))]) {
      expect(out).toContain('data-lead="record"');
      expect(out).toContain(`>${PASSED}</strong>`);
      expect(out).not.toContain("<a ");
    }
  });
});
