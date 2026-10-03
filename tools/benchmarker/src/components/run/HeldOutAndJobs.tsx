// The run's provenance: when and where it ran. (The held-out squares live in RunTime's panel, beside the time bars.)
// squareClass is the colour a story's square takes.
import type { Row } from "../../../shared/types.ts";
import { ranView, type StoryResult } from "../../../shared/runView.ts";
import { qualityClass } from "../../format.ts";
import { Missing, Section, Term, utc } from "./bits.tsx";

/** The square's colour class: the app's pass-rate scale for a story with a result, outlined for one without. */
export const squareClass = (r: StoryResult) => (r.state === "result" ? `rs-sq ${qualityClass(r.passed / r.total)}` : `rs-sq rs-${r.state}`);

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
