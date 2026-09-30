import type { Row, State } from "../../shared/types.ts";
import { otherRuns } from "../../shared/runView.ts";
import { Breadcrumb, CombinationLink } from "../components/EntityLinks.tsx";
import { RunHeader } from "../components/run/RunHeader.tsx";
import { StoryStrip } from "../components/run/StoryStrip.tsx";
import { RunTime } from "../components/run/RunTime.tsx";
import { RunCost } from "../components/run/RunCost.tsx";
import { HeldOut, Jobs } from "../components/run/HeldOutAndJobs.tsx";
import { CompareRuns, RelatedRuns } from "../components/run/CompareAndRelated.tsx";
import "./run.css";

/** Everything about one run, in reading order: identity, outcome, where the time went, cost, evidence, provenance
 * (plan section 4.3). */
export function RunPage({ run, state }: { run: Row; state: State; serverNow: number | null; params?: Record<string, string> }) {
  const others = otherRuns(run, state.rows);
  return (
    <div className="page run-page" data-page="run">
      <Breadcrumb trail={[{ label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> }, { label: run.runId }]} />
      <RunHeader run={run} state={state} />
      <StoryStrip run={run} />
      <RunTime run={run} />
      <RunCost run={run} />
      <HeldOut run={run} />
      <Jobs run={run} />
      {/* Keyed by run: moving to another run's page starts its comparison afresh. */}
      <CompareRuns key={`${run.stack}|${run.runId}`} run={run} others={others} />
      <RelatedRuns run={run} others={others} />
    </div>
  );
}
