// The accounting check in plain words. The harness checks its own arithmetic on each story's time split
// (benchmarks/spec-bench/harness/accounting.py: check() and the log parse before it) and records any problem as a
// sentence. Here each recorded problem is classified mechanically from that sentence, never guessed at; and each
// check, passed, failed or never made, is said with what it means for the story run's time figures, the likely
// cause and what to do. The held-out score never depends on it.
import type { Row, RunStatus, TimeSplit } from "./types.ts";
import { GLOSSARY, type TermId } from "./glossary.ts";

export type CheckStatus = TimeSplit["check"]["status"];

/** What a problem says, by the harness's own phrasing. "other": a phrasing not known here, shown as recorded. */
export type ProblemKind = "waitsCountedTwice" | "clockDisagrees" | "partsDisagree" | "negativePart" | "kindsDisagree" | "neverEnded" | "other";

export interface ProblemView { kind: ProblemKind; raw: string; text: string }

/** The wall and the agent's clock agree within 1% or 1 s: accounting.py's AGENT_CLOCK_TOLERANCE and its floor. */
const AGENT_CLOCK_TOLERANCE = 0.01;
const AGENT_CLOCK_FLOOR_S = 1;

// accounting.py's phrasings, numbers captured as written so the page shows them exactly.
const NUM = "(-?\\d+(?:\\.\\d+)?)";
const CLOCK_RE = new RegExp(`^wall ${NUM} s differs from the agent's own clock \\(${NUM} s(?: \\+ ${NUM} s between sessions)?\\)$`);
const PARTS_RE = new RegExp(`^parts sum to ${NUM} s, not the wall's ${NUM} s$`);
const NEGATIVE_RE = new RegExp(`^negative (\\w+): ${NUM} s$`);
const KINDS_RE = new RegExp(`^tools by kind sum to ${NUM} s, not tools' ${NUM} s$`);
const TOOL_NEVER_RE = /^(?:a )?tool call(?: (\S+))? never ended\b/;
const COMPACTION_NEVER_RE = /^a compaction never ended\b/;
/** A restarted story's problems are prefixed with their attempt (attempts.py). */
const ATTEMPT_RE = /^attempt (\d+): (.*)$/;

/** accounting.py's names for the parts, as the page names them. */
const PART_TERM: Record<string, TermId> = {
  prefill: "segPrefill", decode: "segDecode", tools: "segTools", compaction: "segCompaction", between_sessions: "segBetweenSessions", other: "segOther",
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "The parts…" -> "the parts…": a sentence continuing another. */
export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

function classify(raw: string): { kind: ProblemKind; text: string } {
  let m = CLOCK_RE.exec(raw);
  if (m) {
    const [, wall, agent, waits] = m;
    const between = waits ? Number(waits) : 0;
    // The wall already equals the agent's clock alone, so the waits on top of it were counted twice.
    if (between > 0 && Math.abs(Number(wall) - Number(agent)) <= Math.max(AGENT_CLOCK_FLOOR_S, AGENT_CLOCK_TOLERANCE * Number(wall))) {
      return { kind: "waitsCountedTwice", text: `The wall time (${wall} s) already matches the agent's own clock (${agent} s), but ${waits} s of waits between sessions were added on top of it: they were counted twice.` };
    }
    return { kind: "clockDisagrees", text: `The wall time (${wall} s) doesn't match the agent's own clock (${agent} s)${between > 0 ? ` plus the waits between sessions (${waits} s)` : ""}.` };
  }
  if ((m = PARTS_RE.exec(raw))) return { kind: "partsDisagree", text: `The parts add up to ${m[1]} s, but the wall time is ${m[2]} s.` };
  if ((m = NEGATIVE_RE.exec(raw))) {
    const term = PART_TERM[m[1]];
    return { kind: "negativePart", text: `The ${term ? GLOSSARY[term].name : m[1]} part is negative (${m[2]} s); no part of the time can be.` };
  }
  if ((m = KINDS_RE.exec(raw))) return { kind: "kindsDisagree", text: `The tools by kind add up to ${m[1]} s, but Tools is ${m[2]} s.` };
  if ((m = TOOL_NEVER_RE.exec(raw))) return { kind: "neverEnded", text: `${m[1] ? `Tool call ${m[1]}` : "A tool call"} has no end in the log, so its time was counted up to the agent's next step.` };
  if (COMPACTION_NEVER_RE.test(raw)) return { kind: "neverEnded", text: "A compaction has no end in the log, so its time was counted up to the end of the story." };
  return { kind: "other", text: sentence(capital(raw)) };
}

/** One recorded problem in plain words, keeping its numbers exactly as recorded. */
export function readProblem(raw: string): ProblemView {
  const a = ATTEMPT_RE.exec(raw);
  if (!a) return { raw, ...classify(raw) };
  const inner = classify(a[2]);
  return { raw, kind: inner.kind, text: `Attempt ${a[1]}: ${lower(inner.text)}` };
}

// ---------- one story's check ----------

/** What the check's advice depends on: who ran the run, where its record is, the machine with its full logs, and
 * whether it is still going. */
export type CheckRun = Pick<Row, "client" | "dir" | "machine" | "status">;

export interface CheckView {
  status: CheckStatus;
  /** The word for it: "passed", "failed", "unchecked". */
  label: string;
  /** What it means for this story run's time figures. */
  meaning: string;
  problems: ProblemView[];
  /** Why a check failed, as far as the problems say; null otherwise. */
  cause: string | null;
  /** What to do, ending with ":" when the command follows. */
  todo: string;
  /** The recompute, where it applies and the run has a record. */
  command: string | null;
}

/** backfill_timing.py lives in the harness folder, three below the repo; the run's record is under the repo. */
export const HARNESS_DIR = "benchmarks/spec-bench/harness";
const HARNESS_DEPTH = HARNESS_DIR.split("/").length;
export const recomputeCommand = (dir: string) => `uv run backfill_timing.py --recompute ${"../".repeat(HARNESS_DEPTH)}${dir}`;

const CLAUDE_CLIENT = "claude";
const STILL_GOING: RunStatus[] = ["running", "queued"];

const LABEL: Record<CheckStatus, string> = { ok: "passed", problems: "failed", unchecked: "unchecked" };
const TIP_HEAD: Record<CheckStatus, string> = {
  ok: "Accounting check passed.", problems: "Accounting check failed.", unchecked: "Unchecked: no accounting check was made.",
};

const OK_MEANING = "The parts add up to the wall time and agree with the agent's own clock, so this story run's time figures can be trusted.";
const FAILED_MEANING = "This story run's time figures (the bar, the agent time and the shares) can't be trusted. Its held-out result is unaffected.";
const CLAUDE_MEANING = "This Claude Code run was recorded before the harness read Claude Code's logs for its time, so the whole story counts as “Model, not split” and there is nothing to check. It isn't a fault, and the held-out result is unaffected.";
const OLDER_MEANING = "This story run was recorded before the harness checked its time accounting, so its parts were never verified to add up. The held-out result is unaffected.";
const NEVER_ENDED_CAUSE = "The agent's log has no end for it, usually a session cut off mid-call.";
const NEVER_ENDED_TODO = "Nothing to fix: recomputing reads the same log and gives the same answer. Read the part it fell in as an upper estimate.";
const DOUBLE_CAUSE = "An older harness counted the waits between sessions twice (a bug since fixed)";
const GENERIC_CAUSE = "The record was made by a harness with a bug since fixed";

const isClaude = (run: Pick<Row, "client">) => run.client === CLAUDE_CLIENT;
export const stillGoing = (run: Pick<Row, "status">) => STILL_GOING.includes(run.status);
export const where = (run: Pick<Row, "machine">) => `on ${run.machine}, the machine that ran it, in the repo's ${HARNESS_DIR}`;
/** A recompute of a record never checked needs the full logs the machine kept (backfill_timing.py reads them). */
const needsLogs = (what: string) => `It needs the full logs that machine kept: without them ${what} can't be checked.`;

const INVESTIGATE_TODO = "Nothing to run: recomputing does the same calculation on the same log and gives the same answer. It is a harness problem to investigate.";
const investigateCause = (version: number | null | undefined) =>
  `Not known. The harness's current accounting${version == null ? "" : ` (version ${version})`} made this record, so it isn't a bug since fixed.`;

type Check = TimeSplit["check"];

/** What fixes a failed check.
 * - "log": only calls with no end. That is the agent's log itself, which nothing changes.
 * - "recompute": the harness's own arithmetic, redone by a recompute: the waits counted twice (a known bug since
 *   fixed, whatever made the record), or any problem in a record the current accounting didn't make (or isn't known
 *   to have made).
 * - "investigate": any other problem in a record the harness's current accounting made. It isn't a bug since fixed,
 *   and a recompute (the same calculation on the same log) gives the same answer. */
export type FixClass = "recompute" | "log" | "investigate";

const redone = (problems: ProblemView[]) => problems.filter((p) => p.kind !== "neverEnded");

export function fixClass(check: Pick<Check, "problems" | "current">): FixClass {
  const rest = redone(check.problems.map(readProblem));
  if (!rest.length) return "log";
  return check.current === true && rest.some((p) => p.kind !== "waitsCountedTwice") ? "investigate" : "recompute";
}

/** Why failed checks happened, and what to do, for one story's check or several stories' together: a recompute if
 * any needs one (its cause from those it would redo), else to investigate if any does, else the log itself. A
 * recompute's cause is named only when it explains every problem the recompute would redo. */
export function failedAdvice(checks: Pick<Check, "problems" | "current" | "version">[], run: Pick<CheckRun, "dir" | "machine" | "status">): Pick<CheckView, "cause" | "todo" | "command"> & { fix: FixClass } {
  const of = (fix: FixClass) => checks.filter((c) => fixClass(c) === fix);
  const recompute = of("recompute"), investigate = of("investigate");
  if (recompute.length) {
    const going = stillGoing(run);
    const base = redone(recompute.flatMap((c) => c.problems.map(readProblem))).every((p) => p.kind === "waitsCountedTwice") ? DOUBLE_CAUSE : GENERIC_CAUSE;
    return {
      fix: "recompute",
      cause: `${base}${going ? ", and this run is still going on it" : ""}.`,
      todo: `${going ? "Once the run has finished, recompute" : "Recompute"} this record from the full logs ${where(run)}:`,
      command: run.dir ? recomputeCommand(run.dir) : null,
    };
  }
  if (investigate.length) return { fix: "investigate", cause: investigateCause(investigate[0].version), todo: INVESTIGATE_TODO, command: null };
  return { fix: "log", cause: NEVER_ENDED_CAUSE, todo: NEVER_ENDED_TODO, command: null };
}

/** One story's check: what it means, what was wrong, why and what to do. */
export function checkView(check: TimeSplit["check"], run: CheckRun): CheckView {
  const base = { status: check.status, label: LABEL[check.status], problems: [] as ProblemView[], cause: null, command: null };
  if (check.status === "ok") return { ...base, meaning: OK_MEANING, todo: "Nothing to do." };
  if (check.status === "unchecked") {
    // A Claude Code run from before the harness read Claude Code's logs, or any run from before it checked: either
    // is filled in by the same recompute, where the machine kept the full logs.
    const command = run.dir ? recomputeCommand(run.dir) : null;
    if (isClaude(run)) return { ...base, meaning: CLAUDE_MEANING, command, todo: `Nothing is needed for the held-out result. To fill in its time, recompute this record ${where(run)}. ${needsLogs("this story run")}` };
    return { ...base, meaning: OLDER_MEANING, command, todo: `To check it, recompute this record ${where(run)}. ${needsLogs("this story run")}` };
  }
  const { cause, todo, command } = failedAdvice([check], run);
  return { ...base, meaning: FAILED_MEANING, problems: check.problems.map(readProblem), cause, todo, command };
}

/** "What to do: …", then the command. */
const todoLine = (todo: string, command: string | null) => `What to do: ${lower(todo)}${command ? ` ${command}` : ""}`;

/** The same, in one paragraph: the hover on a check's mark. */
export function checkTip(v: CheckView): string {
  if (v.status === "ok") return `${TIP_HEAD.ok} ${v.meaning}`;
  return [
    TIP_HEAD[v.status], v.meaning, ...v.problems.map((p) => p.text),
    v.cause ? `Likely cause: ${lower(v.cause)}` : "", todoLine(v.todo, v.command),
  ].filter(Boolean).join(" ");
}

// ---------- a run's stories together ----------

export interface RunCheckSummary {
  /** The stories whose check failed, and those never checked. */
  failed: string[];
  unchecked: string[];
  /** One line for the page; the hover adds each problem, the cause and what to do. */
  text: string;
  tip: string;
}

/** "story 4", "stories 4 and 5", "stories 1, 2 and 7". */
function storyList(ids: string[]): string {
  if (ids.length === 1) return `story ${ids[0]}`;
  return `stories ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

/** How many of the stories with a split are unchecked: "All 2 stories …", "The one story …", "1 of the 2 …". */
function uncheckedCount(n: number, of: number): string {
  if (n === of) return of === 1 ? "The one story with a time split is unchecked" : `All ${of} stories with a time split are unchecked`;
  return `${n} of the ${of} stories with a time split ${n === 1 ? "is" : "are"} unchecked`;
}

/** A run's checks over its recorded stories: which failed and which were never made, said once for the run (the
 * run page's time section, the combination page's bar per run). Null when every check passed or none was recorded. */
export function runCheckSummary(run: Pick<Row, "stories"> & CheckRun): RunCheckSummary | null {
  const withSplit = run.stories.filter((s) => s.usage?.split);
  const failed = withSplit.filter((s) => s.usage!.split!.check.status === "problems");
  const unchecked = withSplit.filter((s) => s.usage!.split!.check.status === "unchecked").map((s) => s.id);
  if (!failed.length && !unchecked.length) return null;
  const texts: string[] = [], tips: string[] = [];
  if (failed.length) {
    const one = failed.length === 1;
    const head = `Accounting check failed on ${storyList(failed.map((s) => s.id))}: ${one ? "its" : "their"} time figures can't be trusted. ${one ? "Its held-out result is" : "Their held-out results are"} unaffected.`;
    const problems = failed.flatMap((s) => s.usage!.split!.check.problems.map((p) => ({ id: s.id, p: readProblem(p) })));
    const advice = failedAdvice(failed.map((s) => s.usage!.split!.check), run);
    texts.push(head);
    tips.push(head, ...problems.map(({ id, p }) => `Story ${Number(id)}: ${lower(p.text)}`), `Likely cause: ${lower(advice.cause!)}`, todoLine(advice.todo, advice.command));
  }
  if (unchecked.length) {
    const count = uncheckedCount(unchecked.length, withSplit.length);
    const line = isClaude(run)
      ? `${count}: recorded before the harness read Claude Code's logs for their time, so there is nothing to check. It isn't a fault, and the held-out results are unaffected.`
      : `${count}: recorded before the harness checked its time accounting. The held-out results are unaffected.`;
    texts.push(line);
    tips.push(line, `To ${isClaude(run) ? "fill them in" : "check them"}, recompute this record ${where(run)}. ${needsLogs("they")}`, run.dir ? recomputeCommand(run.dir) : "");
  }
  return { failed: failed.map((s) => s.id), unchecked, text: texts.join(" "), tip: tips.filter(Boolean).join(" ") };
}
