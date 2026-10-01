// How predictable a combination is: the spread of its thinking and of its time across its finished runs, each
// beside its amount. The figures are shared/predictability.ts's; this only lays them out.
import type { Row } from "../../../shared/types.ts";
import { MIN_RUNS_FOR_SPREAD, predictability, type Predictability as Figures } from "../../../shared/predictability.ts";
import { Missing, Term, termTip } from "./Term.tsx";
import { fmtCount, fmtTokens } from "./Spread.tsx";

const PERCENT = 100;

export const fmtSpread = (x: number) => `${Math.round(x * PERCENT)}%`;
export const fmtMinutes = fmtCount;
/** "80k chars" or "23k tokens"; null where no thinking was recorded. */
export const fmtThinking = (p: Figures) => (p.thinkingPerStory === null || p.thinkingUnit === null ? null : `${fmtTokens(p.thinkingPerStory)} ${p.thinkingUnit}`);

/** A spread as a percentage; a dash where there is none, saying how many runs it takes when that is what it lacks. */
export function SpreadFigure({ p, spread, big }: { p: Figures; spread: number | null; big?: string }) {
  if (spread !== null) return <span className={big ?? "num"}>{fmtSpread(spread)}</span>;
  return <Missing why={termTip(p.runs < MIN_RUNS_FOR_SPREAD ? "spreadTooFewRuns" : "spreadNotRecorded")} />;
}

const notRecorded = <Missing why={termTip("spreadNotRecorded")} />;

export function Predictability({ runs }: { runs: Row[] }) {
  const p = predictability(runs);
  return (
    <div className="predictability" data-group="predictability">
      <h3><Term id="predictability" /></h3>
      <dl>
        <div data-pred="thinkingSpread"><dt><Term id="thinkingSpread" /></dt><dd><SpreadFigure p={p} spread={p.thinkingSpread} big="num-l" /></dd></div>
        <div data-pred="thinkingPerStory"><dt><Term id="thinkingPerStory" /></dt>
          <dd>{p.thinkingPerStory === null || p.thinkingUnit === null ? notRecorded : <><span className="num">{fmtTokens(p.thinkingPerStory)}</span> <span className="unit small">{p.thinkingUnit}</span></>}</dd></div>
        <div data-pred="timeSpread"><dt><Term id="timeSpread" /></dt><dd><SpreadFigure p={p} spread={p.timeSpread} big="num-l" /></dd></div>
        <div data-pred="minutesPerStory"><dt><Term id="minutesPerStory" /></dt><dd>{p.minutesPerStory === null ? notRecorded : <span className="num">{fmtMinutes(p.minutesPerStory)}</span>}</dd></div>
        <div data-pred="spreadRuns"><dt><Term id="spreadRuns" /></dt><dd><span className="num">{p.runs}</span></dd></div>
      </dl>
    </div>
  );
}
