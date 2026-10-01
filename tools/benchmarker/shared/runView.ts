// What the run and story-run pages show, worked out from the state: pure functions, so every rule (what counts
// as the score of record, when a story run differs from the others, why a number is missing) is tested once
// here and the components only lay it out.
import type { ConversationProfile, Intervention, Invalid, JobRef, Row, RunStatus, Score, Story, StorySquare, TimeSplit, Usage } from "./types.ts";
import { GLOSSARY, type TermId } from "./glossary.ts";
import { isInvalid, scoreOf } from "./stats.ts";
import { classifyMechanism, type MechanismResult } from "./combinationView.ts";

/** A difference counts when it is more than this share of the number it is compared with (the plan's 10% rule). */
export const DIFF_THRESHOLD = 0.1;
/** Floating point puts all-pass against a median of 10 of 11 (exactly 10% more) at 0.10000000000000003. */
const FLOAT_TOLERANCE = 1e-9;
const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;

// ---------- the run ----------

/** One icon per status, the same everywhere (plan section 5). */
export const STATUS_ICON: Record<RunStatus, string> = {
  finished: "✓", running: "▶", queued: "⏸", failed: "✕", stopped: "■", cancelled: "⊘", unknown: "?",
};

export interface StatusView {
  status: RunStatus;
  icon: string;
  /** Why or how, as the server said it ("finishing story 3", a failure's reason); "" when it said nothing. */
  note: string;
  /** Its place on the machine's queue (1-based, counting the running job), when queued. */
  queuePosition: number | null;
  /** When the record says the run ended (ISO), for a run that has. */
  endedAt: string | null;
}

const ENDED: RunStatus[] = ["finished", "failed", "stopped", "cancelled"];

export function statusView(run: Pick<Row, "status" | "statusNote" | "live" | "stateAt">): StatusView {
  const ended = ENDED.includes(run.status);
  return {
    status: run.status,
    icon: STATUS_ICON[run.status],
    note: run.statusNote,
    queuePosition: run.status === "queued" ? run.live?.queue?.position ?? null : null,
    endedAt: ended && run.stateAt ? run.stateAt : null,
  };
}

export type RecordView =
  | { kind: "scored"; passed: number; total: number; version: string; at: string; flaky: number; currentSuite: boolean }
  | { kind: "none"; reason: "invalid" | "not-finished" | "ended-early" | "not-rescored" | "no-result"; why: string };

const ENDED_EARLY: Partial<Record<RunStatus, string>> = {
  failed: "failed", stopped: "stopped", cancelled: "was cancelled", unknown: "is in an unknown state",
};

/** "Invalid: <reason> (marked <since>)". */
const invalidHead = (inv: Invalid) => `Invalid: ${inv.reason}${inv.since ? ` (marked ${inv.since})` : ""}.`;

/** The run's score of record, or why it has none. An invalid run has none, whatever its re-score. A run that is
 * running or queued again has none, whatever an earlier attempt was scored: its build is about to change. */
export function scoreOfRecord(run: Pick<Row, "status" | "scores" | "suite"> & Partial<Pick<Row, "invalid">>): RecordView {
  if (run.invalid) {
    const found = scoreOf(run as Row);
    const s = found?.[1];
    const was = s && s.passed !== null && s.total !== null ? ` Its re-score, ${s.passed}/${s.total} under ${found![0]}, is not a result: it is left out of every figure.` : " It is left out of every figure.";
    return { kind: "none", reason: "invalid", why: `${invalidHead(run.invalid)}${was}` };
  }
  if (run.status === "running" || run.status === "queued") {
    return { kind: "none", reason: "not-finished", why: `Not finished: the run is ${run.status}. The score of record comes from re-scoring a finished run's final build.` };
  }
  const found = scoreOf(run as Row);
  if (!found) {
    if (run.status !== "finished") {
      return { kind: "none", reason: "ended-early", why: `The run ${ENDED_EARLY[run.status] ?? run.status} before it finished, so it has no score of record.` };
    }
    return { kind: "none", reason: "not-rescored", why: `Finished, but not re-scored under ${run.suite} yet.` };
  }
  const [version, s]: [string, Score] = found;
  if (s.passed === null || s.total === null) {
    return { kind: "none", reason: "no-result", why: `The re-score under ${version} recorded no result.` };
  }
  return { kind: "scored", passed: s.passed, total: s.total, version, at: s.at, flaky: s.flaky, currentSuite: version === run.suite };
}

export interface AgentTime {
  /** Agent seconds over the recorded stories that have a time; null when none has. */
  recordedSeconds: number | null;
  recordedStories: number;
  /** Recorded stories with no time (a story dbench reported before its record arrived, or an old record). */
  untimedStories: number;
  /** Live: agent seconds over the running job's stories so far, the running one included. Only while running. */
  liveSeconds: number | null;
}

export function agentTime(run: Pick<Row, "stories" | "status" | "live">): AgentTime {
  const secs = run.stories.map((s) => s.usage?.agentSeconds ?? null);
  const timed = secs.filter((x): x is number => x !== null);
  const liveMin = run.status === "running" ? run.live?.totalAgentMinutes ?? null : null;
  return {
    recordedSeconds: timed.length ? timed.reduce((a, b) => a + b, 0) : null,
    recordedStories: run.stories.length,
    untimedStories: secs.length - timed.length,
    liveSeconds: liveMin === null ? null : liveMin * SECONDS_PER_MINUTE,
  };
}

/** The stories in the run's scope, in order: its squares, plus any recorded story they don't list. */
export function scopeIds(run: Pick<Row, "stories" | "storiesWorking">): string[] {
  const ids = new Set([...run.storiesWorking.squares.map((q) => q.id), ...run.stories.map((s) => s.id)]);
  return [...ids].toSorted((a, b) => Number(a) - Number(b));
}

const SQUARE_TERM: Record<StorySquare["state"], TermId> = { ok: "sqOk", part: "sqPart", bad: "sqBad", unbuilt: "sqUnbuilt", running: "sqRunning" };

/** A square's hover: "story 2: some of its held-out tests pass (9/10), against the latest build". */
export function squareTip(q: StorySquare): string {
  const counts = q.total ? ` (${q.passed ?? 0}/${q.total})` : "";
  return `story ${q.id}: ${GLOSSARY[SQUARE_TERM[q.state]].what}${counts}${q.total ? ", against the latest build" : ""}`;
}

// ---------- where the time went ----------

export type Seg = keyof Omit<TimeSplit, "wall" | "toolsByKind" | "check">;

/** The parts of a story's time in the order drawn, each with its glossary term (TimeBars draws the same order). */
export const SEGMENTS: { seg: Seg; term: TermId }[] = [
  { seg: "prefill", term: "segPrefill" },
  { seg: "decode", term: "segDecode" },
  { seg: "modelUnsplit", term: "segModelUnsplit" },
  { seg: "compaction", term: "segCompaction" },
  { seg: "tools", term: "segTools" },
  { seg: "betweenSessions", term: "segBetweenSessions" },
  { seg: "other", term: "segOther" },
];

export interface StoryBar { id: string; title: string; split: TimeSplit | null; usage: Usage | null }

/** One bar per recorded story, and the scale they share: the longest wall time among them. */
export function runTimeBars(run: Pick<Row, "stories">): { bars: StoryBar[]; scaleSeconds: number } {
  const bars = run.stories.map((s) => ({ id: s.id, title: s.title, split: s.usage?.split ?? null, usage: s.usage ?? null }));
  return { bars, scaleSeconds: Math.max(1, ...bars.map((b) => b.split?.wall ?? 0)) };
}

export interface SplitPart { seg: Seg; term: TermId; seconds: number; share: number | null }

/** Every part of a split with its share of the wall time, and what the parts leave unaccounted (rounded to the
 * second; non-zero only when the split doesn't add up). */
export function splitParts(split: TimeSplit): { parts: SplitPart[]; unaccounted: number } {
  const parts = SEGMENTS.map(({ seg, term }) => ({ seg, term, seconds: split[seg], share: split.wall > 0 ? split[seg] / split.wall : null }));
  const sum = parts.reduce((t, p) => t + p.seconds, 0);
  return { parts, unaccounted: Math.round(split.wall - sum) };
}

const K = 1000;
const M = 1_000_000;
const count = (n: number | null | undefined) =>
  n == null ? "?" : n >= M ? `${(n / M).toFixed(1)}M` : n >= K ? `${Math.round(n / K)}k` : String(n);
const rate = (n: number | null | undefined) => (n == null ? "?" : n.toFixed(0));

/** A segment's hover: its name, minutes, and what explains it from the story's usage. */
export function segmentTip(seg: Seg, seconds: number, u: Usage | null): string {
  const name = GLOSSARY[SEGMENTS.find((s) => s.seg === seg)!.term].name;
  const m = `${name} ${(seconds / SECONDS_PER_MINUTE).toFixed(1)} min`;
  switch (seg) {
    case "prefill": return `${m}: ${count(u?.prefillTokens)} fresh input tokens at ${rate(u?.prefillTokS)} tok/s`;
    case "decode": return `${m}: ${count(u?.decodeTokens)} tokens at ${rate(u?.decodeTokS)} tok/s`;
    case "modelUnsplit": return `${m}: not split into reading and writing (a cloud model, or a run not timed)`;
    case "compaction": return `${m}, over ${u?.compactions ?? "?"} compactions`;
    case "tools": return `${m} over ${u?.calls ?? "?"} calls`;
    case "betweenSessions": return `${m}: the harness restarting the agent after its session ended (${u?.nudges ?? "?"} nudges)`;
    case "other": return `${m}: the agent's own overhead`;
  }
}

/** Tools time by kind, longest first, in minutes. */
export function toolKinds(split: TimeSplit): { kind: string; seconds: number }[] {
  return Object.entries(split.toolsByKind ?? {}).map(([kind, seconds]) => ({ kind, seconds })).filter((k) => k.seconds > 0).toSorted((a, b) => b.seconds - a.seconds);
}

// ---------- cost ----------

export interface RunTotals {
  outTokens: number | null; readTokens: number | null; calls: number | null;
  tokS: number | null; decodeTokS: number | null; prefillTokS: number | null;
  compactions: number | null; nudges: number | null;
  /** Recorded stories with usage: what the totals are over. */
  stories: number;
}

/** The run's totals: the server's (speeds weighted by time), plus compactions and nudges summed over its stories. */
export function runTotals(run: Pick<Row, "usage" | "stories">): RunTotals {
  const us = run.stories.map((s) => s.usage).filter((u): u is Usage => !!u);
  const sum = (f: (u: Usage) => number | null) => (us.some((u) => f(u) != null) ? us.reduce((t, u) => t + (f(u) ?? 0), 0) : null);
  return {
    outTokens: run.usage.outTokens, readTokens: run.usage.readTokens, calls: run.usage.calls,
    tokS: run.usage.tokS, decodeTokS: run.usage.decodeTokS, prefillTokS: run.usage.prefillTokS,
    compactions: sum((u) => u.compactions), nudges: sum((u) => u.nudges), stories: us.length,
  };
}

export type Missing = "story" | "decode" | "prefill" | "draft" | "cached";

/** Why a story's number is missing, for the "—" hover. Never a guess at zero. */
export function whyMissing(u: Usage | null | undefined, what: Missing): string {
  if (!u) return "Not recorded: this story's record has no usage (it was reported by dbench before its record arrived, or recorded before usage was kept).";
  const untimed = u.split ? u.split.modelUnsplit > 0 : false;
  switch (what) {
    case "story": return "Not recorded for this story.";
    case "draft": return "The engine reported no drafting: it doesn't use speculative decoding, or doesn't say.";
    case "cached": return "The record doesn't split input into fresh and cached tokens.";
    case "decode":
    case "prefill":
      return untimed
        ? "The model wasn't timed apart from the agent: a cloud model (nothing local to time), or a run from before the harness timed every engine."
        : `Not recorded: the harness didn't time the model's ${what === "decode" ? "generation" : "reading"} for this story.`;
  }
}

/** Why a run total is missing: nothing recorded yet, or a model never timed on any story. */
export function whyRunMissing(run: Pick<Row, "stories" | "status">, what: "tokens" | "speed" | "model-speed" | "counter"): string {
  if (!run.stories.some((s) => s.usage)) {
    return run.status === "queued" ? "Nothing recorded yet: the run is queued." : "Nothing recorded yet: no story of this run has usage in its record.";
  }
  if (what === "model-speed") return "No story of this run timed the model on its own (a cloud model, or a run from before the harness timed every engine).";
  return "Not in any of this run's story records.";
}

// ---------- held-out ----------

export interface LiveStep { id: string; passed: number | null; total: number | null }

/** Live: the whole suite so far after each recorded story, in order. */
export function liveProgress(run: Pick<Row, "stories">): LiveStep[] {
  return run.stories.toSorted((a, b) => Number(a.id) - Number(b.id)).map((s) => ({ id: s.id, passed: s.passed, total: s.total }));
}

export type Agreement =
  | { kind: "agree"; passed: number; total: number }
  | { kind: "differ"; live: number; record: number; total: number }
  | { kind: "incomparable"; why: string };

/** Does the live figure after the last story match the score of record? Only when they count the same tests. */
export function heldOutAgreement(run: Pick<Row, "status" | "scores" | "suite" | "stories">): Agreement {
  const rec = scoreOfRecord(run);
  if (rec.kind === "none") return { kind: "incomparable", why: "There is no score of record to check the live figure against." };
  const last = liveProgress(run).findLast((s) => s.total !== null && s.passed !== null);
  if (!last) return { kind: "incomparable", why: "No story recorded a live held-out figure." };
  if (last.total !== rec.total) {
    return { kind: "incomparable", why: `Not the same tests: the live figure after story ${last.id} counts ${last.total} tests, the score of record ${rec.total}.` };
  }
  return last.passed === rec.passed
    ? { kind: "agree", passed: rec.passed, total: rec.total }
    : { kind: "differ", live: last.passed!, record: rec.passed, total: rec.total };
}

// ---------- jobs ----------

export interface JobView extends JobRef { place: number; of: number; restart: boolean }

/** Each job with its place: "job 2 of 2". Every job after the first is a restart. */
export function jobsView(run: Pick<Row, "jobs">): JobView[] {
  return run.jobs.map((j, i) => ({ ...j, place: i + 1, of: run.jobs.length, restart: i > 0 }));
}

// ---------- comparing ----------

/** How far value is from base, as a share of base: 0.12 is 12% more. Missing when either is missing, or when
 * base is 0 and value isn't (no share of nothing); then the difference is infinite, and signed. */
export function relDiff(value: number | null | undefined, base: number | null | undefined): number | null {
  if (value == null || base == null) return null;
  if (base === 0) return value === 0 ? 0 : value > 0 ? Infinity : -Infinity;
  return (value - base) / base;
}

/** More than the threshold away, either way. Exactly 10% is not more than 10%. */
export const isOver = (rel: number | null, threshold = DIFF_THRESHOLD) => rel !== null && Math.abs(rel) > threshold + FLOAT_TOLERANCE;

/** "+12%", "−8%", "±0%", "from 0"; "" for nothing to say. */
export function signedPercent(rel: number | null): string {
  if (rel === null) return "";
  if (!Number.isFinite(rel)) return "from 0";
  const p = Math.round(rel * PERCENT);
  return p === 0 ? "±0%" : p > 0 ? `+${p}%` : `−${-p}%`;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type MeasureKey = "minutes" | "outTokens" | "calls" | "tokS" | "heldOut";

export interface Measure { key: MeasureKey; term: TermId; value: (s: Story) => number | null }

/** The per-story numbers compared between runs. Held-out compares pass rates, so a story whose suite grew still
 * compares like with like. */
export const COMPARE_MEASURES: Measure[] = [
  { key: "minutes", term: "agentTime", value: (s) => s.usage?.agentSeconds ?? null },
  { key: "outTokens", term: "outTokens", value: (s) => s.usage?.outTokens ?? null },
  { key: "calls", term: "calls", value: (s) => s.usage?.calls ?? null },
  { key: "tokS", term: "tokS", value: (s) => s.usage?.tokS ?? null },
  { key: "heldOut", term: "storyHeldOut", value: (s) => (s.ownTotal ? (s.ownPassed ?? 0) / s.ownTotal : null) },
];

export interface CompareCell { key: MeasureKey; a: number | null; b: number | null; rel: number | null; flagged: boolean }
export interface CompareRow { id: string; title: string; inA: boolean; inB: boolean; cells: CompareCell[] }

/** Two runs story by story: every story either recorded, each measure with a's difference from b. */
export function compareRuns(a: Pick<Row, "stories">, b: Pick<Row, "stories">): CompareRow[] {
  const ids = [...new Set([...a.stories, ...b.stories].map((s) => s.id))].toSorted((x, y) => Number(x) - Number(y));
  return ids.map((id) => {
    const sa = a.stories.find((s) => s.id === id);
    const sb = b.stories.find((s) => s.id === id);
    const cells = COMPARE_MEASURES.map(({ key, value }) => {
      const va = sa ? value(sa) : null, vb = sb ? value(sb) : null;
      const rel = relDiff(va, vb);
      return { key, a: va, b: vb, rel, flagged: isOver(rel) };
    });
    return { id, title: sa?.title || sb?.title || "", inA: !!sa, inB: !!sb, cells };
  });
}

/** The other runs of the run's combination in its pack, in run order ("v2-r2" before "v2-r10"). */
export function otherRuns(run: Pick<Row, "pack" | "stack" | "runId">, rows: Row[]): Row[] {
  return rows.filter((r) => r.pack === run.pack && r.stack === run.stack && r.runId !== run.runId).toSorted(byRunId);
}

export const byRunId = (a: Pick<Row, "runId">, b: Pick<Row, "runId">) => a.runId.localeCompare(b.runId, "en", { numeric: true });

// ---------- the story run ----------

export type StoryRunState =
  | { kind: "recorded"; story: Story }
  | { kind: "inProgress"; agentMinutes: number | null; calls: number | null; outputTokens: number | null; startedAt: number | null }
  | { kind: "notBuilt"; why: string }
  | { kind: "outOfScope" };

const WENT_PAST = "Not built: the run went past this story without recording it.";

/** A running run already recorded, or is on, a later story: it won't come back to this one. */
const wentPast = (run: Pick<Row, "stories" | "live">, id: string) =>
  run.stories.some((s) => Number(s.id) > Number(id)) || Number(run.live?.runningStory ?? 0) > Number(id);

/** What is known about one story of a run: its record, the live figures while it is built, or why there's nothing. */
export function storyRunState(run: Pick<Row, "stories" | "storiesWorking" | "status" | "live">, id: string): StoryRunState {
  const story = run.stories.find((s) => s.id === id);
  if (story) return { kind: "recorded", story };
  const running = run.status === "running" && (run.live?.runningStory === id || run.storiesWorking.squares.some((q) => q.id === id && q.state === "running"));
  if (running) {
    const l = run.live;
    return { kind: "inProgress", agentMinutes: l?.agentMinutes ?? null, calls: l?.calls ?? null, outputTokens: l?.outputTokens ?? null, startedAt: l?.storyStartedAt ?? null };
  }
  if (!scopeIds(run).includes(id)) return { kind: "outOfScope" };
  const at = run.live?.runningStory;
  const why = run.status === "queued" ? "The run is queued: no story is built yet."
    : run.status === "running" && wentPast(run, id) ? WENT_PAST
    : run.status === "running" ? `Not built yet: the run is ${at ? `at story ${at}` : "on an earlier story"}.`
    : run.status === "finished" ? "Not built: the run finished without recording this story."
    : `Not built: the run ${ENDED_EARLY[run.status] ?? "ended"} before it reached this story.`;
  return { kind: "notBuilt", why };
}

/** A run without this story, as the Against table says it: a short phrase, with the full why for its hover. A
 * running run that hasn't reached the story yet says so, rather than that the story wasn't built. */
export function againstAbsent(run: Pick<Row, "stories" | "storiesWorking" | "status" | "live">, id: string): { text: string; why: string } {
  const st = storyRunState(run, id);
  if (st.kind === "inProgress") return { text: "building this story now", why: "The run is building this story now: it has no record of it until the story ends." };
  if (st.kind === "outOfScope") return { text: "not in this run's scope", why: "The run's scope doesn't include this story." };
  const why = st.kind === "notBuilt" ? st.why : "";
  if (run.status === "queued") return { text: "queued: not started yet", why };
  if (run.status === "running" && !wentPast(run, id)) return { text: "hasn't reached this story yet", why };
  return { text: "not built in this run", why };
}

/** The story before and after this one in the run's scope. */
export function neighbours(run: Pick<Row, "stories" | "storiesWorking">, id: string): { prev: string | null; next: string | null } {
  const ids = scopeIds(run);
  const i = ids.indexOf(id);
  if (i < 0) return { prev: null, next: null };
  return { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
}

/** The story's title: this run's record, the live title while it is built, else any run of the pack that has it. */
export function storyTitle(run: Pick<Row, "pack" | "stories" | "live">, rows: Pick<Row, "pack" | "stories">[], id: string): string {
  const own = run.stories.find((s) => s.id === id)?.title;
  if (own) return own;
  if (run.live?.runningStory === id && run.live.storyTitle) return run.live.storyTitle;
  for (const r of rows) {
    if (r.pack !== run.pack) continue;
    const t = r.stories.find((s) => s.id === id)?.title;
    if (t) return t;
  }
  return "";
}

export interface Divergence { value: number | null; median: number; n: number; rel: number | null; flagged: boolean }

/** This story run's number against the median of the other runs' (missing values left out). Null when no other
 * run has the number: there is nothing to differ from. */
export function divergence(value: number | null | undefined, others: (number | null | undefined)[]): Divergence | null {
  const xs = others.filter((x): x is number => x != null);
  const m = median(xs);
  if (m === null) return null;
  const rel = relDiff(value, m);
  return { value: value ?? null, median: m, n: xs.length, rel, flagged: isOver(rel) };
}

export type AgainstKey = "heldOut" | "minutes" | "outTokens" | "calls" | "thinking" | "largestThinking";

/** What a story run is judged on against the combination's other runs: its own held-out pass rate first (quality
 * before cost), then what it cost. Thinking is judged only this way: a large block is normal for some combinations
 * (a median largest block of 30-39k characters), so its size means something only against the same story in the
 * same combination. */
export const AGAINST_MEASURES: { key: AgainstKey; term: TermId; value: (s: Story) => number | null }[] = [
  { key: "heldOut", term: "storyRunHeldOut", value: COMPARE_MEASURES.find((m) => m.key === "heldOut")!.value },
  ...COMPARE_MEASURES.filter((m): m is Measure & { key: AgainstKey } => m.key === "minutes" || m.key === "outTokens" || m.key === "calls"),
  { key: "thinking", term: "thinking", value: (s) => s.conversation?.thinkingChars ?? null },
  { key: "largestThinking", term: "largestThinking", value: (s) => s.conversation?.largestThinking?.chars ?? null },
];

export interface AgainstEntry { run: Row; story: Story | null; isThis: boolean }

/** The same story in every run of the combination (this one marked), on one time scale, with this story run's
 * divergence from the median of the others (invalid ones left out) on each measure; when any is flagged, the
 * mechanism (the combination page's rules, against the same other runs); and the most typical other run. */
export function againstCombination(run: Row, rows: Row[], id: string): {
  entries: AgainstEntry[]; scaleSeconds: number; flags: Record<AgainstKey, Divergence | null>;
  mechanism: MechanismResult | null; typical: TypicalRun | null;
} {
  const all = rows.filter((r) => r.pack === run.pack && r.stack === run.stack).toSorted(byRunId);
  const entries = all.map((r) => ({ run: r, story: r.stories.find((s) => s.id === id) ?? null, isThis: r.runId === run.runId }));
  const mine = entries.find((e) => e.isThis)?.story ?? null;
  // Invalid runs are shown among them, but are no yardstick.
  const others = entries.filter((e) => !e.isThis && e.story && !isInvalid(e.run));
  const flags = Object.fromEntries(AGAINST_MEASURES.map(({ key, value }) =>
    [key, divergence(mine ? value(mine) : null, others.map((e) => value(e.story!)))])) as Record<AgainstKey, Divergence | null>;
  const scaleSeconds = Math.max(1, ...entries.map((e) => e.story?.usage?.split?.wall ?? 0));
  const flagged = AGAINST_MEASURES.some(({ key }) => flags[key]?.flagged);
  const mechanism = mine && flagged ? classifyMechanism(mine, others.map((e) => e.story!)) : null;
  return { entries, scaleSeconds, flags, mechanism, typical: typicalRun(entries) };
}

/** The mechanism rules look for what makes a figure higher, so they don't say why one is lower… */
export const BELOW_CAVEAT = "The rules look only for what makes a figure higher (a hung command, a restart, more thinking, more steps, compaction, slower generation), so below the median the label says how the conversation compared, not why the figure is lower.";
/** …and they read cost, not the build: they don't say why a held-out result differs. */
export const HELD_OUT_CAVEAT = "The rules explain cost, not quality: the label says how the conversation compared, not why this held-out result differs.";

const withStop = (s: string) => (s.endsWith(".") ? s : `${s}.`);

/** A flag's hover in the against-the-combination table: how far from the median of how many runs, the mechanism
 * and every rule that fired with its numbers (as the combination page's flag says them), and where the rules can't
 * answer the question the flag raises, says so. */
export function againstFlagTip(key: AgainstKey, d: Divergence, medianText: string, mech: MechanismResult | null): string {
  const head = `${GLOSSARY.divergence.what} The median of the other ${d.n} ${d.n === 1 ? "run" : "runs"}: ${medianText}.`;
  if (!mech) return head;
  const why = mech.fired.length ? mech.fired.map((f) => `${f.label}: ${f.evidence}`).join(" · ") : mech.evidence;
  const caveat = key === "heldOut" ? HELD_OUT_CAVEAT : d.rel !== null && d.rel < 0 ? BELOW_CAVEAT : "";
  return [head, `Mechanism: ${mech.label}.`, withStop(why), caveat].filter(Boolean).join(" ");
}

// ---------- the most typical other run ----------

export interface TypicalRun {
  run: Row; story: Story;
  /** How many of the measures it has a figure for (where the others have a median). */
  measures: number;
  /** The sum, over those, of its distance from the median as a share of the median. */
  deviation: number;
}

/** The medoid of the other runs: among the valid other runs that recorded the story, the one with the most of the
 * measures, then the smallest sum of relative deviations from each measure's median over them (the median row);
 * a tie goes to the earlier run. Null when no valid other run recorded the story. */
export function typicalRun(entries: AgainstEntry[]): TypicalRun | null {
  const pool = entries.filter((e) => !e.isThis && e.story && !isInvalid(e.run)).toSorted((a, b) => byRunId(a.run, b.run));
  const medians = AGAINST_MEASURES.map(({ value }) => median(pool.map((e) => value(e.story!)).filter((x): x is number => x != null)));
  let best: TypicalRun | null = null;
  for (const e of pool) {
    let measures = 0, deviation = 0;
    AGAINST_MEASURES.forEach(({ value }, i) => {
      const v = value(e.story!), m = medians[i];
      if (v === null || m === null) return;
      measures += 1;
      deviation += Math.abs(relDiff(v, m)!);
    });
    if (!best || measures > best.measures || (measures === best.measures && deviation < best.deviation - FLOAT_TOLERANCE)) {
      best = { run: e.run, story: e.story!, measures, deviation };
    }
  }
  return best;
}

// ---------- what differed: two story runs side by side ----------

export type DifferGroup = "outcome" | "cost" | "time" | "conversation";
export type DifferUnit = "passRate" | "seconds" | "tokens" | "count" | "chars" | "tokS" | "times";
/** One story run's figure, or why it has none. */
export interface DifferSide { value: number | null; why: string | null }
export interface DifferRow {
  key: string; group: DifferGroup; term: TermId;
  /** A tool's or a kind's name, for the rows there is one of per tool or kind. */
  label: string | null;
  unit: DifferUnit;
  /** Counted from the conversation profile: a story run without one has none of these. */
  needsProfile: boolean;
  a: DifferSide; b: DifferSide;
  /** a over b; 1 when both are 0; null when either is missing or b alone is 0 (ratioWhy says which). */
  ratio: number | null;
  ratioWhy: string | null;
  /** More than 10% apart, the 10% rule. */
  differs: boolean;
}
export interface DifferedView { rows: DifferRow[]; profile: { a: boolean; b: boolean } }

const WHY_NO_HELD_OUT = "Its own held-out tests weren't recorded.";
const WHY_NO_USAGE = "No usage recorded for this story run.";
const WHY_NOT_RECORDED = "Not recorded for this story run.";
const WHY_NO_SPLIT = "No time split recorded for this story run.";
const WHY_NO_KINDS = "Its tool time wasn't recorded by kind.";
const WHY_NO_PROFILE = "No conversation profile for this story run.";
const WHY_NOT_COUNTED = "The harness couldn't count this from the story run's event log.";
const WHY_ONE_MISSING = "One of the two has no figure here, so there is no ratio.";
const WHY_OTHER_ZERO = "The other run's figure is 0, so there is no ratio.";

const side = (value: number | null | undefined, why: string): DifferSide => (value == null ? { value: null, why } : { value, why: null });
const ofUsage = (f: (u: Usage) => number | null) => (s: Story) => (s.usage ? side(f(s.usage), WHY_NOT_RECORDED) : side(null, WHY_NO_USAGE));
const ofSplit = (f: (t: TimeSplit) => number | null) => (s: Story) =>
  !s.usage ? side(null, WHY_NO_USAGE) : !s.usage.split ? side(null, WHY_NO_SPLIT) : side(f(s.usage.split), WHY_NOT_RECORDED);
const ofProfile = (f: (c: ConversationProfile) => number | null) => (s: Story) =>
  (s.conversation ? side(f(s.conversation), WHY_NOT_COUNTED) : side(null, WHY_NO_PROFILE));
const growth = (c: ConversationProfile) => (c.contextStart && c.contextEnd != null ? c.contextEnd / c.contextStart : null);

interface DifferSpec { key: string; group: DifferGroup; term: TermId; unit: DifferUnit; get: (s: Story) => DifferSide }

/** The rows in order; tools by kind follow "tools" and tools by name close the conversation (see whatDiffered). */
const DIFFER_SPECS: DifferSpec[] = [
  { key: "heldOut", group: "outcome", term: "storyRunHeldOut", unit: "passRate", get: (s) => side(AGAINST_MEASURES[0].value(s), WHY_NO_HELD_OUT) },
  { key: "minutes", group: "cost", term: "agentTime", unit: "seconds", get: ofUsage((u) => u.agentSeconds) },
  { key: "outTokens", group: "cost", term: "outTokens", unit: "tokens", get: ofUsage((u) => u.outTokens) },
  { key: "readTokens", group: "cost", term: "inputTokens", unit: "tokens", get: ofUsage((u) => u.readTokens) },
  { key: "calls", group: "cost", term: "calls", unit: "count", get: ofUsage((u) => u.calls) },
  { key: "decodeTokS", group: "cost", term: "decodeTokS", unit: "tokS", get: ofUsage((u) => u.decodeTokS) },
  { key: "compactions", group: "cost", term: "compactions", unit: "count", get: ofUsage((u) => u.compactions) },
  { key: "nudges", group: "cost", term: "nudges", unit: "count", get: ofUsage((u) => u.nudges) },
  { key: "tools", group: "time", term: "segTools", unit: "seconds", get: ofSplit((t) => t.tools) },
  { key: "compaction", group: "time", term: "segCompaction", unit: "seconds", get: ofSplit((t) => t.compaction) },
  { key: "betweenSessions", group: "time", term: "segBetweenSessions", unit: "seconds", get: ofSplit((t) => t.betweenSessions) },
  { key: "modelCalls", group: "conversation", term: "modelCalls", unit: "count", get: ofProfile((c) => c.calls) },
  { key: "thinking", group: "conversation", term: "thinking", unit: "chars", get: ofProfile((c) => c.thinkingChars) },
  { key: "thinkingMedian", group: "conversation", term: "thinkingMedian", unit: "chars", get: ofProfile((c) => c.thinkingMedian) },
  { key: "thinkingAfter", group: "conversation", term: "thinkingAfterLargest", unit: "chars", get: ofProfile((c) => c.thinkingMedianAfter) },
  { key: "largestThinking", group: "conversation", term: "largestThinking", unit: "chars", get: ofProfile((c) => c.largestThinking?.chars ?? null) },
  { key: "contextEnd", group: "conversation", term: "contextEnd", unit: "tokens", get: ofProfile((c) => c.contextEnd) },
  { key: "contextGrowth", group: "conversation", term: "contextGrowthTimes", unit: "times", get: ofProfile(growth) },
  { key: "contextJump", group: "conversation", term: "contextJump", unit: "tokens", get: ofProfile((c) => c.largestContextJump?.tokens ?? null) },
  { key: "toolErrors", group: "conversation", term: "toolErrors", unit: "count", get: ofProfile((c) => c.toolErrors) },
  { key: "longestTool", group: "conversation", term: "longestTool", unit: "seconds", get: ofProfile((c) => c.longestTool?.seconds ?? null) },
];

function ratioOf(a: number | null, b: number | null): { ratio: number | null; ratioWhy: string | null } {
  if (a === null || b === null) return { ratio: null, ratioWhy: WHY_ONE_MISSING };
  if (b === 0) return a === 0 ? { ratio: 1, ratioWhy: null } : { ratio: null, ratioWhy: WHY_OTHER_ZERO };
  return { ratio: a / b, ratioWhy: null };
}

function rowOf(spec: Omit<DifferSpec, "get">, label: string | null, a: DifferSide, b: DifferSide): DifferRow {
  return { ...spec, label, needsProfile: spec.group === "conversation", a, b, ...ratioOf(a.value, b.value), differs: isOver(relDiff(a.value, b.value)) };
}

/** Every name either side has in `pick`, the larger figure first, then by name. */
function namesOf(a: Record<string, number> | undefined, b: Record<string, number> | undefined): string[] {
  const big = (n: string) => Math.max(a?.[n] ?? 0, b?.[n] ?? 0);
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].toSorted((x, y) => big(y) - big(x) || x.localeCompare(y));
}

/** Two story runs of the same story, figure by figure: the outcome, the cost, where the time went (tools by kind
 * among it), and the conversation (tool calls by tool among it), each with a over b and the 10% rule. A kind or a
 * tool one run used and the other didn't is 0 for the other, not missing. Nothing here is judged: it is laid side by side. */
export function whatDiffered(a: Story, b: Story): DifferedView {
  const rows: DifferRow[] = [];
  const kindSide = (s: Story, k: string): DifferSide =>
    !s.usage ? side(null, WHY_NO_USAGE) : !s.usage.split ? side(null, WHY_NO_SPLIT) : !s.usage.split.toolsByKind ? side(null, WHY_NO_KINDS) : side(s.usage.split.toolsByKind[k] ?? 0, WHY_NOT_RECORDED);
  const toolSide = (s: Story, n: string): DifferSide => (s.conversation ? side(s.conversation.toolsByName[n] ?? 0, WHY_NOT_COUNTED) : side(null, WHY_NO_PROFILE));
  for (const spec of DIFFER_SPECS) {
    rows.push(rowOf(spec, null, spec.get(a), spec.get(b)));
    if (spec.key === "tools") {
      for (const k of namesOf(a.usage?.split?.toolsByKind, b.usage?.split?.toolsByKind)) {
        rows.push(rowOf({ key: `toolKind:${k}`, group: "time", term: "segTools", unit: "seconds" }, k, kindSide(a, k), kindSide(b, k)));
      }
    }
  }
  for (const n of namesOf(a.conversation?.toolsByName, b.conversation?.toolsByName)) {
    rows.push(rowOf({ key: `tool:${n}`, group: "conversation", term: "toolsByName", unit: "count" }, n, toolSide(a, n), toolSide(b, n)));
  }
  return { rows, profile: { a: !!a.conversation, b: !!b.conversation } };
}

// ---------- the conversation ----------

/** What each signal the harness raises means, in words. An unknown one is shown as it is. */
export const SIGNAL_TEXT: Record<string, string> = {
  "hung-command": "a command that hung",
};

/** Signals the harness no longer raises and that meant nothing on their own: "long-thinking-block" fired on
 * blocks that are normal for some combinations. Older records still carry it; it is left out, and thinking is
 * judged against the combination's other runs instead. */
export const RETIRED_SIGNALS = new Set(["long-thinking-block"]);

export interface ConversationView {
  calls: number; toolCalls: number; thinkingChars: number; thinkingMedian: number;
  before: number | null; after: number | null;
  /** How many times more the model thought per call after the largest block than before it. */
  afterRatio: number | null;
  largest: { chars: number; call: number; minutesIn: number } | null;
  contextStart: number | null; contextEnd: number | null;
  /** How many times the context grew from the first call to the last. */
  contextGrowth: number | null;
  largestJump: { tokens: number; call: number } | null;
  tools: { name: string; calls: number }[];
  toolErrors: number;
  longestTool: { seconds: number; name: string; gist: string } | null;
  signals: string[];
}

export function conversationView(c: ConversationProfile | null | undefined): ConversationView | null {
  if (!c) return null;
  const ratio = (a: number | null, b: number | null) => (a != null && b ? a / b : null);
  return {
    calls: c.calls, toolCalls: c.toolCalls, thinkingChars: c.thinkingChars, thinkingMedian: c.thinkingMedian,
    before: c.thinkingMedianBefore, after: c.thinkingMedianAfter, afterRatio: ratio(c.thinkingMedianAfter, c.thinkingMedianBefore),
    largest: c.largestThinking ? { chars: c.largestThinking.chars, call: c.largestThinking.call, minutesIn: c.largestThinking.atS / SECONDS_PER_MINUTE } : null,
    contextStart: c.contextStart, contextEnd: c.contextEnd, contextGrowth: ratio(c.contextEnd, c.contextStart),
    largestJump: c.largestContextJump,
    tools: Object.entries(c.toolsByName).map(([name, calls]) => ({ name, calls })).toSorted((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    toolErrors: c.toolErrors, longestTool: c.longestTool,
    signals: c.signals.filter((s) => !RETIRED_SIGNALS.has(s)).map((s) => SIGNAL_TEXT[s] ?? s),
  };
}

// ---------- invalid runs and interventions ----------

/** An invalid run's hover, wherever it is named. */
export function invalidTip(inv: Invalid): string {
  return `Invalid run: ${inv.reason}${inv.since ? ` (marked ${inv.since})` : ""}. Shown for the record, struck through, and left out of every figure: rankings, medians, ranges, pooled scores and needs you.`;
}

/** The run's interventions, or with `story` those in that story run (a run-wide one belongs to none). */
export function interventionsOf(run: Partial<Pick<Row, "interventions">>, story?: string): Intervention[] {
  const all = run.interventions ?? [];
  return story === undefined ? all : all.filter((i) => i.story !== null && Number(i.story) === Number(story));
}

export interface InterventionGroup { story: string | null; text: string; count: number; first: number; last: number }

/** Consecutive identical lines about one story as one (a watchdog killing the same silent call every 30 s). */
export function groupInterventions(list: Intervention[]): InterventionGroup[] {
  const out: InterventionGroup[] = [];
  for (const i of list) {
    const prev = out.at(-1);
    if (prev && prev.story === i.story && prev.text === i.text) { prev.count += 1; prev.last = i.at; continue; }
    out.push({ story: i.story, text: i.text, count: 1, first: i.at, last: i.at });
  }
  return out;
}

/** Lines a hover lists before it says how many more there are. */
export const MAX_TIP_INTERVENTIONS = 8;
const ISO_DATE = 10, ISO_MINUTE = 16, HH_MM_FROM = 11;
const MS = 1000;
const iso = (t: number) => new Date(t * MS).toISOString();

/** When a group happened: "2026-09-26 14:17 UTC", or a span "2026-09-26 14:17–14:19 UTC" for repeats. */
export function interventionWhen(g: InterventionGroup): string {
  const a = iso(g.first), b = iso(g.last);
  if (g.count === 1 || a.slice(0, ISO_MINUTE) === b.slice(0, ISO_MINUTE)) return `${a.slice(0, ISO_MINUTE).replace("T", " ")} UTC`;
  const end = a.slice(0, ISO_DATE) === b.slice(0, ISO_DATE) ? b.slice(HH_MM_FROM, ISO_MINUTE) : b.slice(0, ISO_MINUTE).replace("T", " ");
  return `${a.slice(0, ISO_MINUTE).replace("T", " ")}–${end} UTC`;
}

/** The intervened marker's hover: how many, then one line each (repeats collapsed), at most MAX_TIP_INTERVENTIONS. */
export function interventionTip(list: Intervention[]): string {
  if (!list.length) return "";
  const groups = groupInterventions(list);
  const lines = groups.slice(0, MAX_TIP_INTERVENTIONS).map((g) =>
    `${interventionWhen(g)} · ${g.story === null ? "the run" : `story ${g.story}`}: ${g.text}${g.count > 1 ? ` (${g.count} times)` : ""}`);
  const more = groups.length - MAX_TIP_INTERVENTIONS;
  return [`Operator interventions (${list.length}):`, ...lines, ...(more > 0 ? [`… and ${more} more on the run page`] : [])].join("\n");
}

