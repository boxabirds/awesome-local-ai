// Every run on the machine as a log: one table, newest activity first, each run a row with its combination, its
// id, the spec version it built against, its status with its time, its stories against its latest build and its
// score of record. Nothing is grouped or folded: a history shows every run.
import type { ReactNode } from "react";
import type { Row, State } from "../../../shared/types.ts";
import { earlierVersion, machineHistory } from "../../../shared/overviewView.ts";
import { scoreOfRecord } from "../../../shared/stats.ts";
import { interventionsOf, PENDING, scoreOfRecord as recordView, squareTip } from "../../../shared/runView.ts";
import { InterventionMark, interventionHref } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { qualityClass } from "../../format.ts";
import { CombinationLink, RunLink } from "../EntityLinks.tsx";
import { Missing, Term } from "../run/bits.tsx";
import { StatusBadge } from "../run/RunHeader.tsx";

const EARLIER_VERSION = "Not scored: an earlier version of the suite.";

function Score({ run, suites }: { run: Row; suites: Record<string, string> }) {
  const s = scoreOfRecord(run);
  if (!s) {
    // A finished run without one: pending, whatever it was scored under before — unless it's a partial rerun,
    // which by design never gets one, or a run of an earlier suite version, which will not be scored again.
    // The rest: only that it isn't finished.
    if (run.knownGood) return <Missing why="A partial rerun: diagnostic, not scored against the full suite." />;
    if (run.status === "finished" && earlierVersion(run, suites)) return <Missing why={EARLIER_VERSION} />;
    if (run.status === "finished") return <span className="pending" data-tip={GLOSSARY.noScore.what}>{PENDING}</span>;
    const v = recordView(run);
    return <Missing why={v.kind === "none" ? v.why : "No score yet."} />;
  }
  return <span className="of-record" data-tip={GLOSSARY.scoreOfRecord.what}><strong className={qualityClass(s.passed! / s.total!)}>{s.passed}</strong><span className="of">/{s.total}</span></span>;
}

function Stories({ run }: { run: Row }) {
  const { working, squares } = run.storiesWorking;
  if (!squares.length) return <Missing why="No stories in scope are known for this run yet." />;
  return (
    <span className="mini-strip" data-tip={`${working} of ${squares.length} stories pass all their held-out tests. ${squares.map(squareTip).join(" · ")}`}>
      <span className="strip" aria-hidden="true">{squares.map((q) => <span key={q.id} className={`cell q-${q.state}`} />)}</span>
      <span className="live-n">{working}/{squares.length}</span>
    </span>
  );
}

/** The spec version family the run built against, with the exact pack version on hover. */
function Version({ run }: { run: Row }) {
  if (!run.family) return <Missing why="The run's record doesn't say which version it built against." />;
  return <span data-tip={run.packVersion ? `${GLOSSARY.packVersion.name}: ${run.packVersion}` : GLOSSARY.packVersion.what}>{run.family}</span>;
}

/** `runs`: the machine's runs that the header's runs switch shows. `filteredOut`: given when the switch hides some
 * of the machine's runs; shown in place of the list when it hides them all. `suites`: each pack's current suite
 * version (State.suites), to tell a run of an earlier version from one whose score is still to come. */
export function MachineHistory({ runs, filteredOut, suites }: { runs: Row[]; filteredOut?: ReactNode; suites: State["suites"] }) {
  const rows = machineHistory(runs);
  return (
    <section className="mp-section" data-section="history" aria-labelledby="h-mp-history">
      <div className="mp-head">
        <h2 id="h-mp-history"><Term id="history" /></h2>
        <span className="small">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
      </div>
      {runs.length === 0 ? (filteredOut ?? <p className="mp-empty">No runs on this machine yet.</p>) : (
        <table className="history" aria-label="Runs on this machine">
          <colgroup><col className="c-combination" /><col className="c-run" /><col className="c-version" /><col className="c-status" /><col className="c-stories" /><col className="c-score" /></colgroup>
          <thead>
            <tr>
              <th scope="col"><Term id="combination" /></th>
              <th scope="col"><Term id="historyRun" /></th>
              <th scope="col"><Term id="packVersion">Version</Term></th>
              <th scope="col"><Term id="runStatus" /></th>
              <th scope="col"><Term id="storyStrip" /></th>
              <th scope="col"><Term id="scoreOfRecord" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.pack}|${r.stack}|${r.runId}`} data-run={r.runId} data-stack={r.stack} data-status={r.status} data-family={r.family}>
                <td className="h-combination"><CombinationLink pack={r.pack} stack={r.stack} label={r.label} /></td>
                <th scope="row" className="h-run"><RunLink pack={r.pack} stack={r.stack} runId={r.runId} /> <InterventionMark list={interventionsOf(r)} to={interventionHref(r)} compact /></th>
                <td className="h-version">{<Version run={r} />}</td>
                <td><StatusBadge run={r} /></td>
                <td><Stories run={r} /></td>
                <td className="h-score"><Score run={r} suites={suites} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
