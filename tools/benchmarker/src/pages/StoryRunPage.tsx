import type { Row, State, Story } from "../../shared/types.ts";
import { isCloud, storyRunState, storyTitle } from "../../shared/runView.ts";
import { isCompared } from "../../shared/combinationView.ts";
import type { Route } from "../../shared/routes.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { NotRecorded, StoryNav, StoryRunHeader } from "../components/run/StoryRunParts.tsx";
import { Conversation, StoryCost, StoryHost, StoryTime } from "../components/run/StoryDetail.tsx";
import { Against } from "../components/run/Against.tsx";
import { WhatDiffered } from "../components/run/WhatDiffered.tsx";
import { AcrossCombinations } from "../components/run/AcrossCombinations.tsx";
import "./run.css";

/** One run's work on one story (plan section 4.4). A story in scope but not recorded yet shows what is known. */
export function StoryRunPage({ route, run, storyId, state, params }: { route: Route; run: Row; story: Story | null; storyId: string; state: State; serverNow: number | null; params?: Record<string, string> }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  // A story run that isn't compared says so in its header, and has none of the three comparisons.
  const compared = st.kind !== "recorded" || isCompared(st.story);
  return (
    <div className="page story-run-page run-page" data-page="storyRun" data-story-state={st.kind}>
      <Breadcrumb route={route} names={{ combination: run.label }} />
      <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
      {st.kind === "recorded" ? <>
        <StoryTime story={st.story} run={run} />
        <StoryCost usage={st.story.usage} cloud={isCloud(run)} />
        <StoryHost host={st.story.host} />
        <Conversation story={st.story} run={run} />
      </> : <NotRecorded run={run} st={st} />}
      {st.kind === "outOfScope" || !compared ? null : <Against run={run} state={state} storyId={storyId} />}
      {st.kind === "recorded" && compared ? <WhatDiffered run={run} state={state} storyId={storyId} params={params} /> : null}
      {st.kind === "outOfScope" || !compared ? null : <AcrossCombinations run={run} state={state} storyId={storyId} />}
      <StoryNav run={run} state={state} storyId={storyId} />
    </div>
  );
}
