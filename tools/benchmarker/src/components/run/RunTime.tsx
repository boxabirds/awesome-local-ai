// Where the run's time went: one bar per recorded story, all on one scale, each a link to its story run.
import type { Row } from "../../../shared/types.ts";
import { runTimeBars } from "../../../shared/runView.ts";
import { storyRunHref } from "../../../shared/routes.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { duration } from "../../format.ts";
import { Missing, Section } from "./bits.tsx";
import { CheckMark, SegmentLegend, SplitBar } from "./SplitBar.tsx";

export function RunTime({ run }: { run: Row }) {
  const { bars, scaleSeconds } = runTimeBars(run);
  return (
    <Section term="timeSplit" id="time" aside={bars.length ? <span className="small">one scale: the longest story, {duration(scaleSeconds)}</span> : null}>
      {bars.length === 0 ? <p className="rp-empty">No story recorded yet{run.status === "queued" ? ": the run is queued" : ""}.</p> : <>
        <SegmentLegend />
        <div className="rp-bars">
          {bars.map((b) => (
            <div className="rp-bar-row" key={b.id} data-story={b.id}>
              <span className="rp-bar-label">
                <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={b.id}>{b.id}. {b.title || `story ${b.id}`}</StoryRunLink>
              </span>
              <span className="bar-track">
                {b.split ? (
                  // The bar is a second way to the same page for the mouse; the keyboard has the label's link.
                  <a className="bar-link" href={storyRunHref(run.pack, run.stack, run.runId, b.id)} tabIndex={-1} aria-hidden="true">
                    <SplitBar split={b.split} usage={b.usage} scaleSeconds={scaleSeconds} label={`story ${b.id}: ${duration(b.split.wall)}`} />
                  </a>
                ) : <span className="no-split">no time split recorded <Missing why={b.usage ? "This story's record has usage but no time split (recorded before the harness split time)." : "This story's record has no usage: dbench reported it before the record arrived, or it was recorded before usage was kept."} /></span>}
              </span>
              <span className="rp-bar-total num">{b.split ? duration(b.split.wall) : b.usage?.agentSeconds != null ? duration(b.usage.agentSeconds) : ""}</span>
              <span className="rp-bar-check">{b.split ? <CheckMark check={b.split.check} /> : null}</span>
            </div>
          ))}
        </div>
      </>}
    </Section>
  );
}
