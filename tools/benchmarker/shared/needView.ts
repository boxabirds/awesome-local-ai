// What to do about each "needs you" item (shared/overviewView.ts finds them): what it affects, and whether a person
// must act now ("do") or there is nothing to do now ("nothing": it waits for something the data names, or no command
// fixes it). Pure, so every kind × whether its run is still going × whether a command fixes it is tested once here and
// the panel only lays it out. Nothing is said that the data doesn't support: the app can't see a machine's queue for
// re-scores or why a person stopped a run, so it never says when something will resolve by itself.
import type { Finalize, FinalRescore, RunStatus } from "./types.ts";
import type { Need } from "./overviewView.ts";
import { HARNESS_DIR, failedAdvice, fixClass, lower, recomputeCommand, stillGoing, where, type FixClass } from "./accountingView.ts";
import { GLOSSARY } from "./glossary.ts";

/** "do": a person must act, and the advice says how. "nothing": nothing to do now. */
export type NeedGroup = "do" | "nothing";
/** How the advice opens: an action, what it waits for, or that nothing fixes it. */
export type NeedLead = "Do this" | "Waiting" | "Nothing to do";

export interface NeedAdvice {
  group: NeedGroup;
  lead: NeedLead;
  /** What the exception affects: which figures or results, and which it leaves alone. */
  affects: string;
  /** What the record says about why: a final re-score's recorded reason, an accounting failure's likely cause. */
  detail: string | null;
  /** What to do, what it waits for, or why nothing fixes it. Ends with ":" exactly when the command follows. */
  todo: string;
  command: string | null;
  /** What to know before doing it, where the data shows a reason to take care; null otherwise. */
  caution: string | null;
}

export interface NeedItem { need: Need; advice: NeedAdvice }

type Accounting = Extract<Need, { kind: "accounting" }>;

const HARNESS_DEPTH = HARNESS_DIR.split("/").length;
/** A run's record as seen from the harness folder, where the harness's commands are run. */
const fromHarness = (dir: string) => `${"../".repeat(HARNESS_DEPTH)}${dir}`;
const BUNDLE = "workspace.bundle";

/** finalize.py <run-dir> --pack benchmarks/<pack> --record: bundle the workspace, re-score the final build, and commit
 * and push the result with the run's record. */
export const finalizeCommand = (dir: string, pack: string) => `uv run finalize.py ${fromHarness(dir)} --pack benchmarks/${pack} --record`;
/** rescore.py --final from the run's own bundle: only the re-score, which finalize.py leaves alone once one exists. */
export const rescoreCommand = (dir: string, pack: string) =>
  `uv run rescore.py ${fromHarness(dir)} --bundle ${fromHarness(dir)}/${BUNDLE} --pack benchmarks/${pack} --final`;

const NO_SCORE = "This run has no score of record (the final score it is ranked by), so it doesn't count in the ranking.";
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
/** A sentence that announces a command ends with ":" only when there is one to give. */
const announcing = (s: string, command: string | null) => `${s}${command ? ":" : "."}`;

const FINALIZE_SAID: Record<Exclude<FinalRescore, "done">, string> = {
  skipped: "Its final re-score was skipped",
  failed: "Its final re-score failed",
  flagged: "Its final re-score was set aside, not recorded",
};

/** What the run's finalize.json says about its final re-score, the reason as recorded. */
function finalizeDetail(f: Finalize | null): string {
  if (!f) return "Its record has no final re-score: none was run, or it was recorded before the harness kept one.";
  if (f.rescore === "done") return `Its final re-score was made under ${f.version || "a suite version it didn't record"}, which is not the suite version shown here.`;
  return `${FINALIZE_SAID[f.rescore]}: ${f.reason ? sentence(f.reason) : "no reason was recorded."}`;
}

const act = (affects: string, todo: string, command: string | null = null, detail: string | null = null, caution: string | null = null): NeedAdvice =>
  ({ group: "do", lead: "Do this", affects, detail, todo, command, caution });

/** A re-score builds the app and runs the whole held-out suite: on a machine that is benchmarking, it shares the
 * machine with the running job. Whether to wait is the owner's call, so it is said, not decided. */
const busyCaution = (machine: string, busy: boolean) => (busy ? `${machine} is running a job now: a re-score there would share the machine with it.` : null);

/** A status that isn't still going, to ask accountingView for a cause that says nothing of the run's progress. */
const ENDED: RunStatus = "finished";

const ACCOUNTING_NOTHING: Record<Exclude<FixClass, "recompute">, string> = {
  log: "Recomputing reads the same log and gives the same answer. Read the part the call fell in as an upper estimate.",
  investigate: "No command fixes it: recomputing gives the same answer. It is a harness problem to investigate.",
};

function accountingAdvice(n: Accounting): NeedAdvice {
  const run = { dir: n.run.dir ?? null, machine: n.run.machine, status: n.run.status ?? "unknown" };
  // The cause is said as for an ended run: that the run is still going is said by the advice itself, and which
  // harness it is going on now isn't known here (a restarted run may be on a newer one).
  const { fix, cause, command } = failedAdvice(n.stories, { ...run, status: ENDED });
  const one = n.stories.length === 1;
  const affects = `Only ${one ? "this story's" : "these stories'"} time figures are affected (where ${one ? "its" : "their"} time went, ${one ? "its" : "their"} agent time); scores are not.`;
  const detail = cause ? `Likely cause: ${lower(cause)}` : null;
  if (fix !== "recompute") return { group: "nothing", lead: "Nothing to do", affects, detail, todo: ACCOUNTING_NOTHING[fix], command: null, caution: null };
  if (stillGoing(run)) {
    return { group: "nothing", lead: "Waiting", affects, detail, todo: "The run is still going. Recompute its record when it has finished: the command is given here then.", command: null, caution: null };
  }
  return act(affects, announcing(`Recompute this record from the full logs ${where(run)}`, command), command, detail);
}

/** What one need affects and what to do about it. An accounting need with stories of several fix classes follows
 * accountingView's failedAdvice (a recompute first); groupNeeds lists each class as its own item. */
export function needAdvice(n: Need): NeedAdvice {
  switch (n.kind) {
    case "silent":
      return act("The machine is held by a run that has stopped reporting, and anything queued behind it waits. No recorded result is affected.",
        `On ${n.machine}'s page, read the job's log. If it has stopped, press Stop on the job, then Restart: the run resumes at story ${Number(n.story)}.`);
    case "unreachable":
      return act("Nothing can be queued, stopped or watched on it until it answers. Runs already recorded are unaffected.",
        `Check that ${n.machine} is on, on the network, and that its dbench service is running. Its page shows the address that was tried.`);
    case "ended":
      return act(NO_SCORE, `On ${n.run.machine}'s page, under “${GLOSSARY.endedJobs.name}”, press Restart on its job: the run resumes at its first unfinished story.${
        n.status === "stopped" ? " If it was stopped on purpose, there is nothing to do." : ""}`);
    case "idle":
      return act("No result is affected: the machine is doing no benchmarking.", `Queue a run with the “Queue a run” form on ${n.machine}'s page.`);
    case "rescoreFault": {
      const dir = n.run.dir ?? null;
      const caution = busyCaution(n.run.machine, n.machineBusy);
      if (!n.hasBundle) {
        const command = dir ? finalizeCommand(dir, n.run.pack) : null;
        return act(NO_SCORE, announcing(`Its record has no workspace bundle to re-score from. Run the final re-score, which makes one, ${where(n.run)}`, command), command, null, caution);
      }
      const command = dir ? rescoreCommand(dir, n.run.pack) : null;
      // rescore.py only re-scores: unlike finalize.py --record, it doesn't push the record, and the app reads main.
      return act(NO_SCORE, announcing(`Re-score its final build again on ${n.run.machine}, in the repo's ${HARNESS_DIR}, then push the run's record to main so its score shows here`, command), command, null, caution);
    }
    case "unscored": {
      const command = n.run.dir ? finalizeCommand(n.run.dir, n.run.pack) : null;
      const said = n.finalize && n.finalize.rescore !== "done";
      return act(NO_SCORE, announcing(`${said ? "Put right what that reason names, then run the final re-score again" : "Run the final re-score"} ${where(n.run)}`, command), command, finalizeDetail(n.finalize), busyCaution(n.run.machine, n.machineBusy));
    }
    case "accounting":
      return accountingAdvice(n);
  }
}

const FIX_ORDER: FixClass[] = ["recompute", "investigate", "log"];

/** A run's failing stories by what fixes them, one need each (a recompute, to investigate, the log itself): a
 * story that a recompute fixes is never hidden behind one that nothing fixes. */
function byFix(n: Accounting): Accounting[] {
  return FIX_ORDER
    .map((fix) => ({ fix, stories: n.stories.filter((s) => fixClass(s) === fix) }))
    .filter((x) => x.stories.length)
    .map(({ fix, stories }) => ({ ...n, key: `${n.key}:${fix}`, stories }));
}

/** Every need with its advice, in two groups, each in the order given: what a person must do, and what has nothing
 * to do now. */
export function groupNeeds(needs: Need[]): Record<NeedGroup, NeedItem[]> {
  const items = needs.flatMap((n) => (n.kind === "accounting" ? byFix(n) : [n])).map((need): NeedItem => ({ need, advice: needAdvice(need) }));
  return { do: items.filter((i) => i.advice.group === "do"), nothing: items.filter((i) => i.advice.group === "nothing") };
}
