// The same story in each of the combination's runs: a small multiple of time bars on one scale, and the key
// numbers, with this story run marked where it is more than 10% from the median of the others.
import type { Row, State } from "../../../shared/types.ts";
import { AGAINST_MEASURES, againstCombination, signedPercent, type AgainstKey } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { CheckMark, SplitBar } from "./SplitBar.tsx";

const SHOW: Record<AgainstKey, (n: number) => string> = { minutes: duration, outTokens: short, calls: full, thinking: short, largestThinking: short };

export function Against({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { entries, scaleSeconds, flags } = againstCombination(run, state.rows, storyId);
  const others = entries.filter((e) => !e.isThis);
  const withStory = others.filter((e) => e.story).length;
  const aside = <span className="small">{withStory} of the combination's {others.length} other {others.length === 1 ? "run has" : "runs have"} recorded this story</span>;
  if (!entries.some((e) => e.story)) {
    return (
      <Section term="againstCombination" id="against" aside={aside}>
        <p className="rp-empty">No run of this combination has recorded story {storyId} yet, so there is nothing to set this story run against.</p>
      </Section>
    );
  }
  return (
    <Section term="againstCombination" id="against" aside={aside}>
      <div className="table-scroll">
        <table className="rp-table against" aria-label={`Story ${storyId} across the combination's runs`}>
          <thead>
            <tr>
              <th>Run</th>
              <th className="bar-col"><Term id="timeSplit" /></th>
              {AGAINST_MEASURES.map((m) => <th key={m.key} className="n"><Term id={m.term} /></th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ run: r, story, isThis }) => {
              const split = story?.usage?.split ?? null;
              return (
                <tr key={r.runId} data-run={r.runId} className={isThis ? "is-this" : undefined} aria-current={isThis ? "page" : undefined}>
                  <td className="nowrap">
                    <RunLink pack={r.pack} stack={r.stack} runId={r.runId} />
                    {isThis ? <span className="this-mark">this story run</span> : <> · <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId} /></>}
                  </td>
                  <td className="bar-col">
                    {split ? <span className="bar-track"><SplitBar split={split} usage={story!.usage ?? null} scaleSeconds={scaleSeconds} label={`${r.runId}: ${duration(split.wall)}`} /><CheckMark check={split.check} /></span>
                      : <span className="small">{story ? "no time split recorded" : "not built in this run"}</span>}
                  </td>
                  {AGAINST_MEASURES.map((m) => {
                    const v = story ? m.value(story) : null;
                    const d = isThis ? flags[m.key] : null;
                    return (
                      <td key={m.key} className="n" data-measure={m.key} data-flagged={d?.flagged ? "true" : undefined}>
                        {v !== null ? SHOW[m.key](v) : story ? <Missing why={m.key === "thinking" || m.key === "largestThinking" ? "No conversation profile for this story run." : "Not recorded for this story run."} /> : ""}
                        {d?.flagged ? <div className="diff flagged" tabIndex={0} data-tip={`${GLOSSARY.divergence.what} The median of the other ${d.n} ${d.n === 1 ? "run" : "runs"}: ${SHOW[m.key](d.median)}.`}>⚑ {signedPercent(d.rel)}</div> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="median-row">
              <td colSpan={2}><Term id="divergence">Median of the other runs</Term></td>
              {AGAINST_MEASURES.map((m) => {
                const d = flags[m.key];
                return <td key={m.key} className="n" data-measure={m.key}>{d ? <>{SHOW[m.key](d.median)} <span className="small">n={d.n}</span></> : <Missing why="No other run of the combination has this figure for this story, so there is no median to compare with." />}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
