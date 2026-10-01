// What to do about each "needs you" item (shared/overviewView.ts finds them): what it affects and what a person must
// do, with the command and where to run it when there is one. Every item is one a person must act on: what the system
// handles by itself is never listed (a final re-score the harness retries, an accounting check it recomputes). Pure,
// so every kind is tested once here and the panel only lays it out. Nothing is said that the data doesn't support.
import type { Need } from "./overviewView.ts";
import { HARNESS_DIR, where } from "./accountingView.ts";
import { finalizeSaid } from "./finalScore.ts";
import { GLOSSARY } from "./glossary.ts";

/** How every item's advice opens: an action. */
export const NEED_LEAD = "Do this";

export interface NeedAdvice {
  /** What the exception affects: which figures or results, and which it leaves alone. */
  affects: string;
  /** What the record says about why: a final re-score's recorded reason and the attempts made. */
  detail: string | null;
  /** What to do. Ends with ":" exactly when the command follows. */
  todo: string;
  command: string | null;
  /** What to know before doing it, where the data shows a reason to take care; null otherwise. */
  caution: string | null;
}

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
/** A sentence that announces a command ends with ":" only when there is one to give. */
const announcing = (s: string, command: string | null) => `${s}${command ? ":" : "."}`;

const act = (affects: string, todo: string, command: string | null = null, detail: string | null = null, caution: string | null = null): NeedAdvice =>
  ({ affects, detail, todo, command, caution });

/** A re-score builds the app and runs the whole held-out suite: on a machine that is benchmarking, it shares the
 * machine with the running job. Whether to wait is the owner's call, so it is said, not decided. */
const busyCaution = (machine: string, busy: boolean) => (busy ? `${machine} is running a job now: a re-score there would share the machine with it.` : null);

/** What one need affects and what to do about it. */
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
      // A final re-score recorded as done adds nothing: that it gave no score is what the item already says.
      const detail = n.finalize.rescore === "done" ? null : finalizeSaid(n.finalize);
      if (!n.hasBundle) {
        const command = dir ? finalizeCommand(dir, n.run.pack) : null;
        return act(NO_SCORE, announcing(`Its record has no workspace bundle to re-score from. Run the final re-score, which makes one, ${where(n.run)}`, command), command, detail, caution);
      }
      const command = dir ? rescoreCommand(dir, n.run.pack) : null;
      // rescore.py only re-scores: unlike finalize.py --record, it doesn't push the record, and the app reads main.
      return act(NO_SCORE, announcing(`Re-score its final build again on ${n.run.machine}, in the repo's ${HARNESS_DIR}, then push the run's record to main so its score shows here`, command), command, detail, caution);
    }
    case "unscored": {
      const command = n.run.dir ? finalizeCommand(n.run.dir, n.run.pack) : null;
      const said = n.finalize.rescore !== "done";
      return act(NO_SCORE, announcing(`${said ? "Put right what that reason names, then run the final re-score again" : "Run the final re-score"} ${where(n.run)}`, command), command, finalizeSaid(n.finalize), busyCaution(n.run.machine, n.machineBusy));
    }
  }
}
