// The time bar on the run and story-run pages: one story's wall time split into its parts, drawn against a scale
// shared with the bars beside it, so lengths compare. The parts, order, colours, names and hovers are TimeBars.tsx's,
// the one definition every bar uses.
import type { TimeSplit, Usage } from "../../../shared/types.ts";
import { CheckMark, SegmentKey, StorySplitBar } from "../TimeBars.tsx";

export { CheckMark };

export function SplitBar({ split, usage, scaleSeconds, label }: { split: TimeSplit; usage: Usage | null; scaleSeconds: number; label: string }) {
  return <StorySplitBar split={split} usage={usage} scaleSeconds={scaleSeconds} label={label} />;
}

/** What each colour is. */
export function SegmentLegend() {
  return <div className="legend-row" aria-label="Parts of the time"><SegmentKey /></div>;
}
