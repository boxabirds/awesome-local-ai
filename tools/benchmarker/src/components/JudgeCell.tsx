import type { Row, Story } from "../../shared/types.ts";

interface Props { row: Row; url: string }

/** The review page opened on this run (the gallery matches it by setup and run), and on one story when given
 * one: the review page preselects it, with the run's other finished stories there too.
 *
 * The app reads the run from the QUERY and the story from the HASH ("#story=2": placeFromHash in its player.js),
 * so the story goes after the "#". Put in the query it is never read and the link opens at the first story. */
export function judgeLink(url: string, row: Pick<Row, "stack" | "runId">, story?: string): string {
  const query = new URLSearchParams({ setup: row.stack, run: row.runId });
  return `${url}?${query}${story ? `#story=${encodeURIComponent(story)}` : ""}`;
}

/** The way to judging, once the run can be judged (Row.judgeReady); nothing before. */
export function JudgeCell({ row, url }: Props) {
  if (!row.judgeReady) return null;
  return <a className="ready" href={judgeLink(url, row)} target="_blank" rel="noopener">Judge →</a>;
}

/** The same for one story, once that story has a record and the run has its workspace history (Story.judgeReady).
 * Weaker than the run's gate on purpose: a finished story of a running run can be judged. */
export function StoryJudgeLink({ row, url, story }: Props & { story: Pick<Story, "id" | "judgeReady"> }) {
  if (!story.judgeReady) return null;
  return (
    <a className="story-judge" href={judgeLink(url, row, story.id)} target="_blank" rel="noopener"
       data-tip={`Judge story ${story.id} of this run`}>Judge</a>
  );
}
