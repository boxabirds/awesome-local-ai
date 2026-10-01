// A finished run with no score of record: who its final score waits for, and what its pages say about it. The
// harness re-scores a run's final build when the run ends, records how that went in finalize.json, and retries it by
// itself at the machine's next run. It writes needs_person: true only when that can't put it right. So such a run is
// "pending" (nobody has anything to do) unless the harness itself says a person is needed; a record that doesn't say
// (every one from before the harness wrote the field) is pending too. Pure: the Overview's "Needs you" lists only the
// runs that need a person (shared/overviewView.ts), and every page that shows the score says which it is.
import type { Finalize, FinalRescore, Row } from "./types.ts";
import { scoreOfRecord, suiteFamily } from "./stats.ts";

export type FinalScoreOwed = "pending" | "needsPerson";

type OwedRow = Pick<Row, "status" | "scores" | "suite" | "family" | "rescores" | "invalid" | "finalize">;

/** Whether this suite can score the run: it already re-scored it, or the run built the suite's spec version. A run
 * of another spec version (or of none known) can't be scored by it: not an omission anyone has to fix. */
const scorable = (r: OwedRow) => r.rescores.includes(r.suite) || (r.family !== "" && r.family === suiteFamily(r.suite));

/** Who a finished run's missing final score waits for; null when none is owed (it has one, it hasn't finished, it is
 * invalid, or this suite can't score it). */
export function finalScoreOwed(r: OwedRow): FinalScoreOwed | null {
  if (r.status !== "finished" || r.invalid || scoreOfRecord(r as Row) !== null || !scorable(r)) return null;
  return r.finalize?.needsPerson === true ? "needsPerson" : "pending";
}

const FINALIZE_SAID: Record<Exclude<FinalRescore, "done">, string> = {
  skipped: "Its final re-score was skipped",
  failed: "Its final re-score failed",
  flagged: "Its final re-score was set aside, not recorded",
};

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const SINGLE = 1;

/** How often the harness has tried, and when last; "" when it didn't count. */
function tried(f: Finalize): string {
  if (f.attempts === null || f.attempts === undefined) return "";
  return ` Tried ${f.attempts} time${f.attempts === SINGLE ? "" : "s"}${f.lastAttemptAt ? `, last at ${f.lastAttemptAt}` : ""}.`;
}

/** What the run's finalize.json says about its final re-score, the reason as recorded. */
export function finalizeSaid(f: Finalize): string {
  const said = f.rescore === "done"
    ? `Its final re-score was made under ${f.version || "a suite version it didn't record"}, which is not the suite version shown here.`
    : `${FINALIZE_SAID[f.rescore]}: ${f.reason ? sentence(f.reason) : "no reason was recorded."}`;
  return `${said}${tried(f)}`;
}

const NO_FINALIZE = "Its record has no final re-score yet.";

/** What a run's pages say beside its score while its final score is owed; null when none is. */
export function finalScoreNote(r: OwedRow & Pick<Row, "machine">): string | null {
  const owed = finalScoreOwed(r);
  if (owed === null) return null;
  const recorded = r.finalize ? finalizeSaid(r.finalize) : NO_FINALIZE;
  return owed === "pending"
    ? `Final score pending: retried automatically at ${r.machine}'s next run. ${recorded}`
    : `Final score needs a person: the harness can't finish it by itself. ${recorded} What to do is under “Needs you” on the Overview.`;
}
