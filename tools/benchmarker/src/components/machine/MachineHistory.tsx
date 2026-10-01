// Every run on the machine, by combination, then by pack and spec version (v1 and v2 apart, each labelled):
// each run a link, with its status, its stories against its latest build (live) and its score of record.
import type { Row, RunStatus } from "../../../shared/types.ts";
import { machineHistory, type VersionGroup } from "../../../shared/overviewView.ts";
import { scoreOfRecord, unscoredReason } from "../../../shared/stats.ts";
import { finalScoreNote } from "../../../shared/finalScore.ts";
import { interventionsOf, scoreOfRecord as recordView, squareTip } from "../../../shared/runView.ts";
import { InterventionMark, InvalidTag } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { qualityClass } from "../../format.ts";
import { CombinationLink, RunLink } from "../EntityLinks.tsx";
import { LiveTag, Missing, RecordTag, Term } from "../run/bits.tsx";
import { StatusBadge } from "../run/RunHeader.tsx";

/** Why a run has no score of record, in words. */
function noScoreWhy(r: Row): string {
  if (r.status === "finished") {
    const why = r.rescores.includes(r.suite) ? `Re-scored under ${r.suite}, but the re-score gave no score of record.` : `Finished, but ${unscoredReason(r)}.`;
    const note = finalScoreNote(r);
    return note ? `${why} ${note}` : why;
  }
  const v = recordView(r);
  return v.kind === "none" ? v.why : "No score of record.";
}

function Score({ run }: { run: Row }) {
  if (run.invalid) return <InvalidTag invalid={run.invalid} />;
  const s = scoreOfRecord(run);
  if (!s) return <Missing why={noScoreWhy(run)} />;
  return <span className="of-record" data-tip={GLOSSARY.scoreOfRecord.what}><strong className={qualityClass(s.passed! / s.total!)}>{s.passed}</strong><span className="of">/{s.total}</span></span>;
}

function Stories({ run }: { run: Row }) {
  const { working, squares } = run.storiesWorking;
  if (!squares.length) return <Missing why="No stories in scope are known for this run yet." />;
  return (
    <span className="mini-strip" data-tip={`${working} of ${squares.length} stories pass all their held-out tests against the latest build. ${squares.map(squareTip).join(" · ")}`}>
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
        <tr key={r.runId} data-run={r.runId} data-status={r.status} data-invalid={r.invalid ? "true" : undefined}>
          <th scope="row" className="h-run"><RunLink pack={r.pack} stack={r.stack} runId={r.runId} invalid={r.invalid} /> <InterventionMark list={interventionsOf(r)} /></th>
          <td><StatusBadge run={r} /></td>
          <td><Stories run={r} /></td>
          <td className="h-score"><Score run={r} /></td>
        </tr>
      ))}
    </tbody>
  );
}

export function MachineHistory({ runs, hidden, onHidden }: { runs: Row[]; hidden: Set<RunStatus>; onHidden: (h: Set<RunStatus>) => void }) {
  const shown = runs.filter((r) => !hidden.has(r.status));
  const combos = machineHistory(shown);
  const counts = [...new Set(runs.map((r) => r.status))].map((s) => [s, runs.filter((r) => r.status === s).length] as [RunStatus, number]);
  return (
    <section className="mp-section" data-section="history" aria-labelledby="h-mp-history">
      <div className="mp-head">
        <h2 id="h-mp-history"><Term id="history" /></h2>
        <span className="small">{shown.length} of {runs.length} run{runs.length === 1 ? "" : "s"}</span>
        {runs.length ? <HistoryFilter counts={counts} hidden={hidden} onChange={onHidden} /> : null}
      </div>
      {runs.length === 0 ? <p className="mp-empty">No runs on this machine yet.</p>
        : combos.length === 0 ? <p className="mp-empty">No runs with the statuses chosen.</p> : combos.map((c) => (
        <div key={c.stack} className="history-combo" data-stack={c.stack}>
          <h3><CombinationLink pack={c.groups[0].pack} stack={c.stack} label={c.label} /></h3>
          <table className="history" aria-label={`Runs of ${c.label}`}>
            <colgroup><col className="c-run" /><col className="c-status" /><col className="c-stories" /><col className="c-score" /></colgroup>
            <thead>
              <tr>
                <th scope="col"><Term id="historyRun" /></th>
                <th scope="col"><Term id="runStatus" /></th>
                <th scope="col"><Term id="storyStrip" /> <LiveTag /></th>
                <th scope="col"><Term id="scoreOfRecord" /> <RecordTag /></th>
              </tr>
            </thead>
            {c.groups.map((g) => <Group key={`${g.pack}|${g.family}`} g={g} />)}
          </table>
        </div>
      ))}
    </section>
  );
}

const STATUS_ORDER: RunStatus[] = ["running", "queued", "finished", "failed", "stopped", "cancelled", "unknown"];

/** A toggle per status present on the machine, with its count; all shown at first. */
function HistoryFilter({ counts, hidden, onChange }: { counts: [RunStatus, number][]; hidden: Set<RunStatus>; onChange: (h: Set<RunStatus>) => void }) {
  const toggle = (s: RunStatus) => { const n = new Set(hidden); if (n.has(s)) n.delete(s); else n.add(s); onChange(n); };
  return (
    <div className="history-filter" role="group" aria-label="Status">
      {counts.toSorted((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])).map(([s, n]) => (
        <button key={s} type="button" className={`chip s-${s}`} aria-pressed={!hidden.has(s)} onClick={() => toggle(s)}>{s} {n}</button>
      ))}
      {hidden.size ? <button type="button" className="chip link" onClick={() => onChange(new Set())}>all</button> : null}
    </div>
  );
}
