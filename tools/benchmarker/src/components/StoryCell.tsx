import type { Row } from "../../shared/types.ts";
import { StoriesStrip } from "./StoriesStrip.tsx";

/** Which story out of the scope, the running story's title, and one square per story. */
export function StoryCell({ row }: { row: Row }) {
  const live = row.live;
  const scope = live?.storiesInScope ?? null;
  const of = scope ? ` of ${scope}` : "";
  if (row.status === "running" && live) {
    const cur = live.currentStory || live.runningStory;
    return (
      <>
        <div>{cur ? `story ${cur}${of}` : "starting"}</div>
        {live.storyTitle ? <div className="small clip" title={live.storyTitle}>{live.storyTitle}</div> : null}
        <StoriesStrip row={row} />
      </>
    );
  }
  if (row.stories.length === 0) return <span className="wait">—</span>;
  return (
    <>
      <div>{row.stories.length}{of} stories</div>
      <StoriesStrip row={row} />
    </>
  );
}
