// The run's evidence and provenance: each story's own held-out result as a square, and when and where the run ran.
import type { Row } from "../../../shared/types.ts";
import { ranView, storyResults, type StoryResult } from "../../../shared/runView.ts";
import { qualityClass } from "../../format.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { Missing, Section, Term, utc } from "./bits.tsx";

/** The square's colour class: the app's pass-rate scale for a story with a result, outlined for one without. */
export const squareClass = (r: StoryResult) => (r.state === "result" ? `rs-sq ${qualityClass(r.passed / r.total)}` : `rs-sq rs-${r.state}`);

/** One square per story in scope, in story order, coloured by that story's own held-out tests after it. */
export function HeldOut({ run }: { run: Row }) {
  const squares = storyResults(run);
  return (
    <Section term="heldOut" id="heldout">
      {squares.length === 0 ? <p className="rp-empty">No stories in scope are known for this run.</p> : (
        <ol className="rs-strip" aria-label="Held-out result after each story">
          {squares.map((r) => (
            <li key={r.id} data-story={r.id} data-state={r.state} className="rs-item">
              <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>
                <span className={squareClass(r)} aria-hidden="true" data-tip={r.tip} />
                <span className="rs-n" aria-hidden="true">{r.id}</span>
                <span className="sr-only">{r.tip}</span>
              </StoryRunLink>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** When and where the run ran: the machine, when it was first queued there, and when it ended. */
export function Ran({ run }: { run: Row }) {
  const v = ranView(run);
  return (
    <Section term="ran" id="ran">
      <dl className="rows">
        <div data-row="machine"><dt><Term id="machine" /></dt><dd>{v.machine}</dd></div>
        <div data-row="queued"><dt><Term id="ranQueued" /></dt><dd>{v.queuedAt !== null ? utc(v.queuedAt) : <Missing why="When it was queued isn't known." />}</dd></div>
        <div data-row="ended"><dt><Term id="ranEnded" /></dt><dd>{v.endedAt !== null ? utc(v.endedAt) : <span className="small">not ended</span>}</dd></div>
      </dl>
    </Section>
  );
}
