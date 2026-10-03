// The same story in each of the combination's runs: a small multiple of time bars on one scale, each run's own
// held-out result and the key numbers, with this story run marked where it is more than 10% from the median of the
// others, and each mark carrying its mechanism (the combination page's rules) with the rules that fired on hover.
import type { Row, State, Story } from "../../../shared/types.ts";
import { AGAINST_MEASURES, againstAbsent, againstCombination, againstFlagTip, signedPercent, type AgainstKey } from "../../../shared/runView.ts";
import { RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { conversationPartHref, SplitBar } from "./SplitBar.tsx";
import { NO_SPLIT } from "./RunTime.tsx";
import { pct } from "./RunCost.tsx";

const SHOW: Record<AgainstKey, (n: number) => string> = { heldOut: pct, minutes: duration, outTokens: short, calls: full, thinking: short, largestThinking: short };

/** A story run's own figure: held-out as its tests ("7/10"), the rest as SHOW. */
const cellText = (key: AgainstKey, v: number, s: Story) => (key === "heldOut" ? `${s.ownPassed ?? 0}/${s.ownTotal}` : SHOW[key](v));

const MISSING_WHY: Record<AgainstKey, string> = {
  heldOut: "Its own held-out tests weren't recorded.", minutes: "Not recorded for this story run.", outTokens: "Not recorded for this story run.",
  calls: "Not recorded for this story run.", thinking: "No conversation profile for this story run.", largestThinking: "No conversation profile for this story run.",
};

/** A run without the story: whether it hasn't got there yet or never built it, with why on hover and focus. */
function Absent({ run, storyId }: { run: Row; storyId: string }) {
  const a = againstAbsent(run, storyId);
  return <span className="small absent" tabIndex={0} data-tip={a.why}>{a.text}</span>;
}

export function Against({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { entries, scaleSeconds, flags, mechanism, others: n } = againstCombination(run, state.rows, storyId);
  const others = entries.filter((e) => !e.isThis);
  const aside = others.length ? <span className="small">{n} of the combination's {others.length} other {others.length === 1 ? "run has" : "runs have"} recorded this story</span> : null;
  if (!entries.some((e) => e.story)) {
    return (
      <Section term="againstCombination" id="against" aside={aside}>
        <p className="rp-empty">No run of this combination has recorded story {storyId} yet.</p>
      </Section>
    );
  }
  // The median row exists only when some other run has the story: with none, this run's row is the whole table.
  const medians = n > 0;
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
                <tr key={r.runId} data-run={r.runId} className={isThis ? "is-this" : undefined} aria-current={isThis ? "page" : undefined}>
                  <td className="nowrap">
                    <RunLink pack={r.pack} stack={r.stack} runId={r.runId} />
                    {isThis ? <span className="this-mark">this story run</span> : <> · <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId} /></>}
                  </td>
                  <td className="bar-col">
                    {split ? <span className="bar-track"><SplitBar split={split} usage={story!.usage ?? null} scaleSeconds={scaleSeconds} label={`${r.runId}: ${duration(split.wall)}`} hrefOf={conversationPartHref(r, story)} /></span>
                      : story ? <Missing why={NO_SPLIT} /> : <Absent run={r} storyId={storyId} />}
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
            {medians ? (
              <tr className="median-row" data-others={n}>
                <td colSpan={2}><Term id="divergence">Median of the other {n === 1 ? "run" : `${n} runs`}</Term></td>
                {AGAINST_MEASURES.map((m) => {
                  const d = flags[m.key];
                  return <td key={m.key} className="n" data-measure={m.key}>{d ? <>{SHOW[m.key](d.median)}{d.n !== n ? <span className="small"> n={d.n}</span> : null}</> : <Missing why={`None of the other ${n === 1 ? "run has" : "runs have"} this figure for this story.`} />}</td>;
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
