// Every run on the machine, by combination, then by pack and spec version (v1 and v2 apart, each labelled):
// each run a link, with its status, its stories against its latest build and its score of record.
import type { ReactNode } from "react";
import type { Row } from "../../../shared/types.ts";
import { machineHistory, type VersionGroup } from "../../../shared/overviewView.ts";
import { scoreOfRecord } from "../../../shared/stats.ts";
import { interventionsOf, PENDING, scoreOfRecord as recordView, squareTip } from "../../../shared/runView.ts";
import { InterventionMark } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { qualityClass } from "../../format.ts";
import { CombinationLink, RunLink } from "../EntityLinks.tsx";
import { Missing, Term } from "../run/bits.tsx";
import { StatusBadge } from "../run/RunHeader.tsx";

function Score({ run }: { run: Row }) {
  const s = scoreOfRecord(run);
  if (!s) {
    // A finished run without one: pending, whatever it was scored under before — unless it's a partial rerun,
    // which by design never gets one. The rest: only that it isn't finished.
    if (run.knownGood) return <Missing why="A partial rerun: diagnostic, not scored against the full suite." />;
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

const groupLabel = (g: VersionGroup) => `${g.pack} · ${g.family || "version unknown"}`;

function Group({ g }: { g: VersionGroup }) {
  return (
    <tbody data-group={`${g.pack}|${g.family}`}>
      <tr className="group-head">
        <th colSpan={4} scope="rowgroup">
          <span className="version-label">{groupLabel(g)}</span>
          {g.packVersions.length ? <span className="small mono" data-tip={GLOSSARY.packVersion.what}> {g.packVersions.join(", ")}</span> : null}
          <span className="small"> · {g.runs.length} run{g.runs.length === 1 ? "" : "s"}</span>
        </th>
      </tr>
      {g.runs.map((r) => (
        <tr key={r.runId} data-run={r.runId} data-status={r.status}>
          <th scope="row" className="h-run"><RunLink pack={r.pack} stack={r.stack} runId={r.runId} /> <InterventionMark list={interventionsOf(r)} /></th>
          <td><StatusBadge run={r} /></td>
          <td><Stories run={r} /></td>
          <td className="h-score"><Score run={r} /></td>
        </tr>
      ))}
    </tbody>
  );
}

/** `runs`: the machine's runs that the header's runs switch shows. `filteredOut`: given when the switch hides some
 * of the machine's runs; shown in place of the list when it hides them all. */
export function MachineHistory({ runs, filteredOut }: { runs: Row[]; filteredOut?: ReactNode }) {
  const combos = machineHistory(runs);
  return (
    <section className="mp-section" data-section="history" aria-labelledby="h-mp-history">
      <div className="mp-head">
        <h2 id="h-mp-history"><Term id="history" /></h2>
        <span className="small">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
      </div>
      {runs.length === 0 ? (filteredOut ?? <p className="mp-empty">No runs on this machine yet.</p>) : combos.map((c) => (
        <div key={c.stack} className="history-combo" data-stack={c.stack}>
          <h3><CombinationLink pack={c.groups[0].pack} stack={c.stack} label={c.label} /></h3>
          <table className="history" aria-label={`Runs of ${c.label}`}>
            <colgroup><col className="c-run" /><col className="c-status" /><col className="c-stories" /><col className="c-score" /></colgroup>
            <thead>
              <tr>
                <th scope="col"><Term id="historyRun" /></th>
                <th scope="col"><Term id="runStatus" /></th>
                <th scope="col"><Term id="storyStrip" /></th>
                <th scope="col"><Term id="scoreOfRecord" /></th>
              </tr>
            </thead>
            {c.groups.map((g) => <Group key={`${g.pack}|${g.family}`} g={g} />)}
          </table>
        </div>
      ))}
    </section>
  );
}
