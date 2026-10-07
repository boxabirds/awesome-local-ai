import type { Row, Story } from "../../shared/types.ts";

interface Props { row: Row; url: string }

/** The review page opened on this run (the gallery matches it by setup and run), and on one story when given
 * one: the review page preselects it, with the run's other finished stories there too. */
export function judgeLink(url: string, row: Pick<Row, "stack" | "runId">, story?: string): string {
  const params = new URLSearchParams({ setup: row.stack, run: row.runId });
  if (story) params.set("story", story);
  return `${url}?${params}`;
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
