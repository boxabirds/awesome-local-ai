// Where the run's time went: one bar per recorded story, all on one scale, each a link to its story run.
import type { Row } from "../../../shared/types.ts";
import { runTimeBars, storyResults, storyTitle, type StoryResult } from "../../../shared/runView.ts";
import { conversationHref, storyRunHref } from "../../../shared/routes.ts";
import { StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration } from "../../format.ts";
import { Missing, Section, Term } from "./bits.tsx";
import { squareClass } from "./HeldOutAndJobs.tsx";
import { conversationPartHref, SegmentLegend, SplitBar } from "./SplitBar.tsx";

/** The one thing said of a story with no breakdown: it isn't available. Its own total still is. */
export const NO_SPLIT = "No time breakdown for this story.";

/** What an empty row says: the story is being built, or hasn't been reached. Nothing else. */
const ROW_STATE: Partial<Record<StoryResult["state"], string>> = { building: "in progress", unbuilt: "pending" };

/** One panel for the run's stories: each story's own held-out result (the square), and where its time went (the bar),
 * all on one scale. A story being built or not yet reached has an empty bar and a light italic word for it. */
export function RunTime({ run, rows }: { run: Row; rows: Row[] }) {
  const { bars, scaleSeconds } = runTimeBars(run);
  const results = storyResults(run);
  return (
    <Section term="timeSplit" id="time"
      heading={<><Term id="heldOut">Held-out</Term> and <Term id="timeSplit">where the time went</Term></>}
      aside={bars.length ? <span className="small">one scale: the longest story, {duration(scaleSeconds)}</span> : null}>
      {results.length === 0 ? <p className="rp-empty">No stories in scope are known for this run.</p> : <>
        <SegmentLegend />
        <div className="rp-bars">
          {results.map((r) => {
            const b = bars.find((x) => x.id === r.id);
            const title = b?.title || storyTitle(run, rows, r.id);
            return (
              <div className="rp-bar-row" key={r.id} data-story={r.id} data-state={r.state}>
                <span className="rs-cell">
                  <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>
                    <span className={squareClass(r)} aria-hidden="true" data-tip={r.tip} />
                    <span className="sr-only">{r.tip}</span>
                  </StoryRunLink>
                </span>
                <span className="rp-bar-label">
                  <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>{r.id}. {title || `story ${r.id}`}</StoryRunLink>
                </span>
                <span className="bar-track">
                  {!b ? <span className="row-state">{ROW_STATE[r.state] ?? ""}</span>
                    : b.split ? (
                      // The bar is a second way for the mouse: into the story's conversation when the warehouse has it (each
                      // part at its own section), else to the story run's page; the keyboard has the label's link.
                      <a className="bar-link" data-to={b.story.hasConversation ? "conversation" : "storyRun"} href={b.story.hasConversation ? conversationHref(run.pack, run.stack, run.runId, b.id) : storyRunHref(run.pack, run.stack, run.runId, b.id)} tabIndex={-1} aria-hidden="true">
                        <SplitBar split={b.split} usage={b.usage} scaleSeconds={scaleSeconds} label={`story ${b.id}: ${duration(b.split.wall)}`} hrefOf={conversationPartHref(run, b.story)} />
                      </a>
                    ) : <span className="no-split"><Missing why={NO_SPLIT} /></span>}
                </span>
                <span className="rp-bar-total num">{!b ? "" : b.split ? duration(b.split.wall) : b.usage?.agentSeconds != null ? duration(b.usage.agentSeconds) : ""}</span>
                <span className="rp-bar-check">
                  <span className="rp-bar-story" data-tip={GLOSSARY.storyInEveryCombination.what}><StoryLink pack={run.pack} story={r.id}>all runs</StoryLink></span>
                </span>
              </div>
            );
          })}
        </div>
      </>}
    </Section>
  );
}
