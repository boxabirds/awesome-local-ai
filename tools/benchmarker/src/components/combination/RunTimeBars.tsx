// Where each run's time went: one bar per run, its recorded stories' splits summed, every run on one scale. Drawn
// with TimeBars.tsx's SegmentBar and key: the same parts, order, colours and names as every other time bar.
import type { Row } from "../../../shared/types.ts";
import { runOrder, runSplit } from "../../../shared/combinationView.ts";
import { duration } from "../../format.ts";
import { RunLink } from "../EntityLinks.tsx";
import { SEGMENTS, SegmentBar, SegmentKey, segName } from "../TimeBars.tsx";
import { termName, termTip } from "./Term.tsx";

const PERCENT = 100;

export function RunTimeBars({ runs }: { runs: Row[] }) {
  const bars = runOrder(runs).map((r) => ({ r, s: runSplit(r) })).filter((b) => b.s);
  if (!bars.length) return <p className="empty-note">No run has a recorded time split yet.</p>;
  const max = Math.max(...bars.map((b) => b.s!.wall));
  return (
    <figure className="time-bars run-time-bars" aria-label={termName("runTimeSplit")}>
      <figcaption>
        <SegmentKey />
      </figcaption>
      {bars.map(({ r, s }) => {
        const sp = s!;
        const note = [`${sp.stories} recorded stor${sp.stories === 1 ? "y" : "ies"}`, sp.withoutSplit ? `${sp.withoutSplit} without a split` : ""].filter(Boolean).join(", ");
        return (
          <div className="bar-row" key={r.runId} data-run={r.runId}>
            <span className="bar-label">
              <RunLink pack={r.pack} stack={r.stack} runId={r.runId} /> <span className={`small s-${r.status}`}>{r.status}</span>
              <span className="small"> · {note}</span>
            </span>
            <span className="bar-track">
              <SegmentBar parts={sp.parts} wall={sp.wall} scaleSeconds={max} tip={(p, secs) => {
                const term = SEGMENTS.find((x) => x.seg === p)!.term;
                return `${segName(p)} ${duration(secs)} (${Math.round((secs / sp.wall) * PERCENT)}%) over ${note}: ${termTip(term)}`;
              }} />
            </span>
            <span className="bar-total num">{duration(sp.wall)}</span>
          </div>
        );
      })}
    </figure>
  );
}
