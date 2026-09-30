// Where each run's time went: one bar per run, its recorded stories' splits summed, every run on one scale. The same
// segments, colours and order as the story view's time bars, named from the glossary.
import type { Row } from "../../../shared/types.ts";
import type { TermId } from "../../../shared/glossary.ts";
import { runOrder, runSplit, SPLIT_PARTS, type SplitPart } from "../../../shared/combinationView.ts";
import { duration } from "../../format.ts";
import { RunLink } from "../EntityLinks.tsx";
import { termName, termTip } from "./Term.tsx";

const PERCENT = 100;
const SEG_TERM: Record<SplitPart, TermId> = {
  prefill: "segPrefill", decode: "segDecode", modelUnsplit: "segModelUnsplit", compaction: "segCompaction",
  tools: "segTools", betweenSessions: "segBetweenSessions", other: "segOther",
};

export function RunTimeBars({ runs }: { runs: Row[] }) {
  const bars = runOrder(runs).map((r) => ({ r, s: runSplit(r) })).filter((b) => b.s);
  if (!bars.length) return <p className="empty-note">No run has a recorded time split yet.</p>;
  const max = Math.max(...bars.map((b) => b.s!.wall));
  return (
    <figure className="time-bars run-time-bars" aria-label={termName("runTimeSplit")}>
      <figcaption>
        {SPLIT_PARTS.map((p) => <span key={p} className="legend" data-tip={`${termName(SEG_TERM[p])}: ${termTip(SEG_TERM[p])}`}><i className={`seg-${p}`} />{termName(SEG_TERM[p])}</span>)}
      </figcaption>
      {bars.map(({ r, s }) => {
        const sp = s!;
        const note = [`${sp.stories} recorded stor${sp.stories === 1 ? "y" : "ies"}`, sp.withoutSplit ? `${sp.withoutSplit} without a split` : ""].filter(Boolean).join(", ");
        return (
          <div className="bar-row" key={r.runId} data-run={r.runId}>
            <span className="bar-label">
              <RunLink pack={r.pack} stack={r.stack} runId={r.runId} /> <span className={`small s-${r.status}`}>{r.status}</span>
              <span className="small"> · {note}</span>
              {sp.problems.length ? <span className="check-flag" tabIndex={0} role="img" aria-label="accounting check failed" data-tip={`${termName("accountingCheck")} failed, so treat these parts with care: ${sp.problems.join("; ")}`}>⚠</span> : null}
              {sp.unchecked ? <span className="check-unchecked" tabIndex={0} data-tip={`${sp.unchecked} of its stories' splits were recorded before the harness checked its accounting`}>unchecked</span> : null}
            </span>
            <span className="bar-track">
              <span className="bar" style={{ width: `${(sp.wall / max) * PERCENT}%` }}>
                {SPLIT_PARTS.filter((p) => sp.parts[p] > 0).map((p) => (
                  <span key={p} data-seg={p} className={`seg seg-${p}`} style={{ width: `${(sp.parts[p] / sp.wall) * PERCENT}%` }}
                    data-tip={`${termName(SEG_TERM[p])} ${duration(sp.parts[p])} (${Math.round((sp.parts[p] / sp.wall) * PERCENT)}%) over ${note}: ${termTip(SEG_TERM[p])}`} />
                ))}
              </span>
            </span>
            <span className="bar-total num">{duration(sp.wall)}</span>
          </div>
        );
      })}
    </figure>
  );
}
