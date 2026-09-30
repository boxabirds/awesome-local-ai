// One square per story in the run's scope, coloured by its held-out result as the stories-working squares are, each
// a link to its story run.
import type { Row, StorySquare } from "../../../shared/types.ts";
import { squareTip } from "../../../shared/runView.ts";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { Section } from "./bits.tsx";

const STATES: [StorySquare["state"], TermId][] = [["ok", "sqOk"], ["part", "sqPart"], ["bad", "sqBad"], ["running", "sqRunning"], ["unbuilt", "sqUnbuilt"]];

export function StoryStrip({ run }: { run: Row }) {
  const { working, squares } = run.storiesWorking;
  const built = squares.filter((q) => q.state !== "unbuilt" && q.state !== "running").length;
  return (
    <Section term="storyStrip" id="stories" aside={<span className="small">{working} of the {built} stories built so far pass all their held-out tests · {squares.length} in scope · against the latest build</span>}>
      {squares.length === 0 ? <p className="rp-empty">No stories in scope are known for this run.</p> : (
        <div className="rp-strip">
          {squares.map((q) => (
            <span key={q.id} className="sq-wrap" data-tip={squareTip(q)} data-story={q.id} data-state={q.state}>
              <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={q.id}>
                <span className={`rp-sq q-${q.state}`} aria-hidden="true">{q.id}</span>
                <span className="sr-only">{squareTip(q)}</span>
              </StoryRunLink>
            </span>
          ))}
        </div>
      )}
      <div className="legend-row">
        {STATES.map(([s, t]) => <span key={s} className="legend"><i className={`q-${s}`} />{GLOSSARY[t].name}</span>)}
      </div>
    </Section>
  );
}
