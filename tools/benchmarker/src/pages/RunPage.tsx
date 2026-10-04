import { useEffect } from "react";
import type { Row, State } from "../../shared/types.ts";
import { interventionCount, otherRuns } from "../../shared/runView.ts";
import type { Route } from "../../shared/routes.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { RunHeader } from "../components/run/RunHeader.tsx";
import { RunStories } from "../components/run/RunStories.tsx";
import { Ran } from "../components/run/HeldOutAndJobs.tsx";
import { CompareRuns, RelatedRuns } from "../components/run/CompareAndRelated.tsx";
import { InterventionList, INTERVENTIONS_SECTION } from "../components/RunMarks.tsx";
import { Section } from "../components/run/bits.tsx";
import "./run.css";

/** Every intervention in the run, with the stories they were in; only for a run that has any. The guard firing more
 * than once on one silent call is one intervention (shared/runView.ts), so the count is of those, not of the lines. */
function Interventions({ run }: { run: Row }) {
  const list = run.interventions ?? [];
  if (!list.length) return null;
  const n = interventionCount(list);
  return (
    <Section term="interventions" id={INTERVENTIONS_SECTION} aside={<span className="small">{n} in all; the run stays in every figure</span>}>
      <InterventionList list={list} run={run} />
    </Section>
  );
}

/** Everything about one run, in reading order: identity, outcome, where the time went, cost, evidence, provenance
 * (plan section 4.3). */
export function RunPage({ route, run, state, params }: { route: Route; run: Row; state: State; serverNow: number | null; params?: Record<string, string> }) {
  const others = otherRuns(run, state.rows);
  // ?at=<section>: a mark elsewhere asking for that part of the page (the run's intervened mark asks for its
  // interventions). Scrolled to once the page is laid out, and only when that section is there.
  const at = params?.at;
  useEffect(() => {
    if (at) document.querySelector(`[data-section="${CSS.escape(at)}"]`)?.scrollIntoView({ block: "start" });
  }, [at, run.runId]);
  return (
    <div className="page run-page" data-page="run">
      <Breadcrumb route={route} names={{ combination: run.label }} />
      <RunHeader run={run} state={state} />
      <RunStories run={run} rows={state.rows} />
      <Ran run={run} />
      <Interventions run={run} />
      {/* Keyed by run: moving to another run's page starts its comparison afresh. */}
      <CompareRuns key={`${run.stack}|${run.runId}`} run={run} others={others} params={params} />
      <RelatedRuns run={run} others={others} />
    </div>
  );
}
