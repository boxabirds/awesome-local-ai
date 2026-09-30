// The time bar: one story's wall time split into its parts, in TimeBars' order and colours (the same classes),
// drawn against a scale shared with the bars beside it, so lengths compare.
import type { TimeSplit, Usage } from "../../../shared/types.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { SEGMENTS, segmentTip } from "../../../shared/runView.ts";

const PERCENT = 100;

export function SplitBar({ split, usage, scaleSeconds, label }: { split: TimeSplit; usage: Usage | null; scaleSeconds: number; label: string }) {
  return (
    <span className="bar" role="img" aria-label={label} style={{ width: `${(split.wall / scaleSeconds) * PERCENT}%` }}>
      {SEGMENTS.filter((s) => split[s.seg] > 0).map((s) => (
        <span key={s.seg} data-seg={s.seg} className={`seg seg-${s.seg}`} style={{ width: `${(split[s.seg] / split.wall) * PERCENT}%` }} data-tip={segmentTip(s.seg, split[s.seg], usage)} />
      ))}
    </span>
  );
}

/** What each colour is. */
export function SegmentLegend() {
  return (
    <div className="legend-row" aria-label="Parts of the time">
      {SEGMENTS.map((s) => <span key={s.seg} className="legend" data-tip={`${GLOSSARY[s.term].name}: ${GLOSSARY[s.term].what}`}><i className={`seg-${s.seg}`} />{GLOSSARY[s.term].name}</span>)}
    </div>
  );
}

/** The split's own check, as TimeBars shows it: nothing when it passed, ⚠ with the problems, or "unchecked". */
export function CheckMark({ check }: { check: TimeSplit["check"] }) {
  if (check.status === "ok") return null;
  if (check.status === "unchecked") {
    return <span className="check-unchecked" tabIndex={0} data-tip="Unchecked: recorded before the harness checked its accounting (or a cloud model, whose calls aren't logged), so these parts weren't verified to add up">unchecked</span>;
  }
  return <span className="check-flag" tabIndex={0} role="img" aria-label="accounting check failed" data-tip={`This split failed its checks, so treat its parts with care: ${check.problems.join("; ")}`}>⚠</span>;
}
