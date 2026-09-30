// What the run and story-run pages show, worked out from the state: pure functions, so every rule (what counts
// as the score of record, when a story run differs from the others, why a number is missing) is tested once
// here and the components only lay it out.
import type { ConversationProfile, JobRef, Row, RunStatus, Score, Story, StorySquare, TimeSplit, Usage } from "./types.ts";
import { GLOSSARY, type TermId } from "./glossary.ts";
import { scoreOf } from "./stats.ts";

/** A difference counts when it is more than this share of the number it is compared with (the plan's 10% rule). */
export const DIFF_THRESHOLD = 0.1;
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
  | { kind: "none"; reason: "not-finished" | "ended-early" | "not-rescored" | "no-result"; why: string };

const ENDED_EARLY: Partial<Record<RunStatus, string>> = {
  failed: "failed", stopped: "stopped", cancelled: "was cancelled", unknown: "is in an unknown state",
};

/** The run's score of record, or why it has none. A run that is running or queued again has none, whatever an
 * earlier attempt was scored: its build is about to change. */
export function scoreOfRecord(run: Pick<Row, "status" | "scores" | "suite">): RecordView {
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
export const isOver = (rel: number | null, threshold = DIFF_THRESHOLD) => rel !== null && Math.abs(rel) > threshold;

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
    : run.status === "running" ? `Not built yet: the run is ${at ? `at story ${at}` : "on an earlier story"}.`
    : run.status === "finished" ? "Not built: the run finished without recording this story."
    : `Not built: the run ${ENDED_EARLY[run.status] ?? "ended"} before it reached this story.`;
  return { kind: "notBuilt", why };
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

export type AgainstKey = "minutes" | "outTokens" | "calls" | "thinking" | "largestThinking";

/** What a story run is judged on against the combination's other runs. Thinking is judged only this way: a large
 * block is normal for some combinations (a median largest block of 30-39k characters), so its size means
 * something only against the same story in the same combination. */
export const AGAINST_MEASURES: { key: AgainstKey; term: TermId; value: (s: Story) => number | null }[] = [
  ...COMPARE_MEASURES.filter((m): m is Measure & { key: AgainstKey } => m.key === "minutes" || m.key === "outTokens" || m.key === "calls"),
  { key: "thinking", term: "thinking", value: (s) => s.conversation?.thinkingChars ?? null },
  { key: "largestThinking", term: "largestThinking", value: (s) => s.conversation?.largestThinking?.chars ?? null },
];

export interface AgainstEntry { run: Row; story: Story | null; isThis: boolean }

/** The same story in every run of the combination (this one marked), on one time scale, with this story run's
 * divergence from the median of the others on time, output tokens and calls. */
export function againstCombination(run: Row, rows: Row[], id: string): {
  entries: AgainstEntry[]; scaleSeconds: number; flags: Record<AgainstKey, Divergence | null>;
} {
  const all = rows.filter((r) => r.pack === run.pack && r.stack === run.stack).toSorted(byRunId);
  const entries = all.map((r) => ({ run: r, story: r.stories.find((s) => s.id === id) ?? null, isThis: r.runId === run.runId }));
  const mine = entries.find((e) => e.isThis)?.story ?? null;
  const others = entries.filter((e) => !e.isThis && e.story);
  const flags = Object.fromEntries(AGAINST_MEASURES.map(({ key, value }) =>
    [key, divergence(mine ? value(mine) : null, others.map((e) => value(e.story!)))])) as Record<AgainstKey, Divergence | null>;
  const scaleSeconds = Math.max(1, ...entries.map((e) => e.story?.usage?.split?.wall ?? 0));
  return { entries, scaleSeconds, flags };
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
