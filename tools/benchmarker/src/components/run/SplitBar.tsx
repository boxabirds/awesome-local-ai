// The time bar on the run and story-run pages: one story's wall time split into its parts, drawn against a scale
// shared with the bars beside it, so lengths compare. The parts, order, colours, names and hovers are TimeBars.tsx's,
// the one definition every bar uses.
import type { Story, TimeSplit, Usage } from "../../../shared/types.ts";
import { SEGMENT_ANCHOR } from "../../../shared/conversation.ts";
import { conversationHref } from "../../../shared/routes.ts";
import { SegmentKey, StorySplitBar, type Seg } from "../TimeBars.tsx";

export function SplitBar({ split, usage, scaleSeconds, label, hrefOf }: { split: TimeSplit; usage: Usage | null; scaleSeconds: number; label: string; hrefOf?: (seg: Seg) => string | null }) {
  return <StorySplitBar split={split} usage={usage} scaleSeconds={scaleSeconds} label={label} hrefOf={hrefOf} />;
}

/** Where a story run's bar parts lead: into its conversation at the part's section, when the warehouse has it. */
export function conversationPartHref(run: { pack: string; stack: string; runId: string }, story: Pick<Story, "id" | "hasConversation"> | null | undefined): ((seg: Seg) => string | null) | undefined {
  if (!story?.hasConversation) return undefined;
  return (seg) => conversationHref(run.pack, run.stack, run.runId, story.id, SEGMENT_ANCHOR[seg]);
}

/** What each colour is. */
export function SegmentLegend() {
  return <div className="legend-row" aria-label="Parts of the time"><SegmentKey /></div>;
}
