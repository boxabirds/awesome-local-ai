import type { Row, State, Story } from "../../shared/types.ts";
import { Breadcrumb, CombinationLink, RunLink } from "../components/EntityLinks.tsx";

/** One run's work on one story. (Being built: plan section 4.4.) */
export function StoryRunPage({ run, story }: { run: Row; story: Story | null; storyId: string; state: State; serverNow: number | null }) {
  return (
    <div className="page story-run-page" data-page="storyRun">
      <Breadcrumb trail={[{ label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> }, { label: <RunLink pack={run.pack} stack={run.stack} runId={run.runId} /> }, { label: `story ${story?.id ?? ""}` }]} />
      <h1>{story ? `Story ${story.id}: ${story.title}` : "Story not built yet"}</h1>
    </div>
  );
}
