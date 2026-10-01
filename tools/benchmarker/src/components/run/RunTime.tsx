// Where the run's time went: one bar per recorded story, all on one scale, each a link to its story run.
import type { Row } from "../../../shared/types.ts";
import { runTimeBars } from "../../../shared/runView.ts";
import { storyRunHref } from "../../../shared/routes.ts";
import { StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration } from "../../format.ts";
import { Missing, Section } from "./bits.tsx";
import { SegmentLegend, SplitBar } from "./SplitBar.tsx";

/** The one thing said of a story with no breakdown: it isn't available. Its own total still is. */
export const NO_SPLIT = "No time breakdown for this story.";

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
                ) : <span className="no-split"><Missing why={NO_SPLIT} /></span>}
              </span>
              <span className="rp-bar-total num">{b.split ? duration(b.split.wall) : b.usage?.agentSeconds != null ? duration(b.usage.agentSeconds) : ""}</span>
              <span className="rp-bar-check">
                <span className="rp-bar-story" data-tip={GLOSSARY.storyInEveryCombination.what}><StoryLink pack={run.pack} story={b.id}>all runs</StoryLink></span>
              </span>
            </div>
          ))}
        </div>
      </>}
    </Section>
  );
}
