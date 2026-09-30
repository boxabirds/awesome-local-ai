// How many flagged story runs each mechanism explains, on the metric shown: "verbose thinking 1 of 9 story runs".
import { DIVERGENCE, MECHANISM_TERM, MIN_RUNS_FOR_MEDIAN, tally, type Matrix } from "../../../shared/combinationView.ts";
import { Term } from "./Term.tsx";

const PERCENT = 100;

export function MechanismTally({ matrix, metricLabel }: { matrix: Matrix; metricLabel: string }) {
  const t = tally(matrix);
  const comparable = [...matrix.medians.values()].some((m) => m && m.n >= MIN_RUNS_FOR_MEDIAN);
  if (!comparable) return <p className="empty-note" data-tally="none">No story has {MIN_RUNS_FOR_MEDIAN} finished runs yet, so there is no median to differ from.</p>;
  if (!t.flagged) return <p className="empty-note" data-tally="none">No story run is more than {DIVERGENCE * PERCENT}% from its story's median on {metricLabel}.</p>;
  return (
    <div className="tally" data-tally="some">
      <ul>
        {t.lines.map((l) => (
          <li key={l.label} className="tally-line" data-mechanism={l.label}>
            <Term id={MECHANISM_TERM[l.label]} />
            <b>{l.count} <span className="of">of {t.storyRuns} story runs</span></b>
          </li>
        ))}
      </ul>
      <span className="small">{t.flagged} of {t.storyRuns} story runs flagged on {metricLabel}. <Term id="mechPrecedence">When several rules fire, which wins</Term>.</span>
    </div>
  );
}
