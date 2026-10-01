import type { Row, State, Story } from "../../shared/types.ts";
import { storyRunState, storyTitle } from "../../shared/runView.ts";
import { Breadcrumb, CombinationLink, RunLink } from "../components/EntityLinks.tsx";
import { NotRecorded, StoryNav, StoryRunHeader } from "../components/run/StoryRunParts.tsx";
import { Conversation, StoryCost, StoryTime } from "../components/run/StoryDetail.tsx";
import { Against } from "../components/run/Against.tsx";
import { WhatDiffered } from "../components/run/WhatDiffered.tsx";
import { InvalidBanner } from "../components/RunMarks.tsx";
import "./run.css";

/** One run's work on one story (plan section 4.4). A story in scope but not recorded yet shows what is known. */
export function StoryRunPage({ run, storyId, state, params }: { run: Row; story: Story | null; storyId: string; state: State; serverNow: number | null; params?: Record<string, string> }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  return (
    <div className="page story-run-page run-page" data-page="storyRun" data-story-state={st.kind}>
      <Breadcrumb trail={[
        { label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> },
        { label: <RunLink pack={run.pack} stack={run.stack} runId={run.runId} invalid={run.invalid} /> },
        { label: `story ${storyId}` },
      ]} />
      <InvalidBanner invalid={run.invalid} what="story run" />
      <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
      {st.kind === "recorded" ? <>
        <StoryTime story={st.story} run={run} />
        <StoryCost usage={st.story.usage} />
        <Conversation story={st.story} />
      </> : <NotRecorded run={run} st={st} />}
      {st.kind === "outOfScope" ? null : <Against run={run} state={state} storyId={storyId} />}
      {st.kind === "recorded" ? <WhatDiffered run={run} state={state} storyId={storyId} params={params} /> : null}
      <StoryNav run={run} state={state} storyId={storyId} />
    </div>
  );
}
