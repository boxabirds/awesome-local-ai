import type { Row } from "../../shared/types.ts";

/** Which story out of the scope, and the running story's title. */
export function StoryCell({ row }: { row: Row }) {
  const live = row.live;
  const scope = live?.storiesInScope ?? null;
  const of = scope ? ` of ${scope}` : "";
  if (row.status === "running" && live) {
    const cur = live.currentStory || live.runningStory;
    return (
      <>
        <div>{cur ? `story ${cur}${of}` : "starting"}</div>
        {live.storyTitle ? <div className="small story-title" title={live.storyTitle}>{live.storyTitle}</div> : null}
      </>
    );
  }
  if (row.stories.length === 0) return <span className="wait">—</span>;
  return (
    <div>{row.stories.length}{of} stories built</div>
  );
}
