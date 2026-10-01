// The same story in each of the combination's runs: a small multiple of time bars on one scale, each run's own
// held-out result and the key numbers, with this story run marked where it is more than 10% from the median of the
// others, and each mark carrying its mechanism (the combination page's rules) with the rules that fired on hover.
import type { Row, State, Story } from "../../../shared/types.ts";
import { AGAINST_MEASURES, againstCombination, againstFlagTip, signedPercent, type AgainstKey } from "../../../shared/runView.ts";
import { RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { CheckMark, SplitBar } from "./SplitBar.tsx";
import { pct } from "./RunCost.tsx";

const SHOW: Record<AgainstKey, (n: number) => string> = { heldOut: pct, minutes: duration, outTokens: short, calls: full, thinking: short, largestThinking: short };

/** A story run's own figure: held-out as its tests ("7/10"), the rest as SHOW. */
const cellText = (key: AgainstKey, v: number, s: Story) => (key === "heldOut" ? `${s.ownPassed ?? 0}/${s.ownTotal}` : SHOW[key](v));

const MISSING_WHY: Record<AgainstKey, string> = {
  heldOut: "Its own held-out tests weren't recorded.", minutes: "Not recorded for this story run.", outTokens: "Not recorded for this story run.",
  calls: "Not recorded for this story run.", thinking: "No conversation profile for this story run.", largestThinking: "No conversation profile for this story run.",
};

export function Against({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { entries, scaleSeconds, flags, mechanism } = againstCombination(run, state.rows, storyId);
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
              {AGAINST_MEASURES.map((m) => <th key={m.key} className={`n m-${m.key}`}><Term id={m.term} /></th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ run: r, story, isThis }) => {
              const split = story?.usage?.split ?? null;
              return (
                <tr key={r.runId} data-run={r.runId} className={isThis ? "is-this" : undefined} aria-current={isThis ? "page" : undefined} data-invalid={r.invalid && !isThis ? "true" : undefined}>
                  <td className="nowrap">
                    <RunLink pack={r.pack} stack={r.stack} runId={r.runId} invalid={r.invalid} />
                    {isThis ? <span className="this-mark">this story run</span> : <> · <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId} invalid={r.invalid} /></>}
                  </td>
                  <td className="bar-col">
                    {split ? <span className="bar-track"><SplitBar split={split} usage={story!.usage ?? null} scaleSeconds={scaleSeconds} label={`${r.runId}: ${duration(split.wall)}`} /><CheckMark check={split.check} /></span>
                      : <span className="small">{story ? "no time split recorded" : "not built in this run"}</span>}
                  </td>
                  {AGAINST_MEASURES.map((m) => {
                    const v = story ? m.value(story) : null;
                    const d = isThis ? flags[m.key] : null;
                    const tip = d?.flagged ? againstFlagTip(m.key, d, SHOW[m.key](d.median), mechanism) : undefined;
                    return (
                      <td key={m.key} className="n" data-measure={m.key} data-flagged={d?.flagged ? "true" : undefined}>
                        {v !== null ? cellText(m.key, v, story!) : story ? <Missing why={MISSING_WHY[m.key]} /> : ""}
                        {d?.flagged ? <div className="diff flagged" tabIndex={0} data-tip={tip}>⚑ {signedPercent(d.rel)}</div> : null}
                        {d?.flagged && mechanism ? <div className="mech" data-mechanism={mechanism.label} data-tip={tip}>{mechanism.label}</div> : null}
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
