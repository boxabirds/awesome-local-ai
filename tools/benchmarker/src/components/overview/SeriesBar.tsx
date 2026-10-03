// A series of runs as segments left to right: finished (with its score), running (filled by its stories done),
// queued (outlined). Used on a machine's card and in the series rows.
import type { Series, SeriesRun } from "../../../shared/dashboardView.ts";
import { runHref } from "../../../shared/routes.ts";

const PERCENT = 100;

/** A score's colour by its place between 0 (red) and the suite's total (green), as a percentage the stylesheet mixes
 * the app's red and green by (the tokens, so dark mode follows). */
export const scoreStyle = (score: number, total: number) => ({ ["--score" as string]: `${Math.round((score / total) * PERCENT)}%` });

function Segment({ run, pack }: { run: SeriesRun; pack: string; stack: string }) {
  const filled = run.state === "running" && run.stories.scope ? `${Math.round((run.stories.done / run.stories.scope) * PERCENT)}%` : "0%";
  const tip = run.state === "finished" ? `${run.runId}: finished${run.score !== null ? `, ${run.score} of ${run.total}` : ""}`
    : run.state === "running" ? `${run.runId}: running, ${run.stories.done} of ${run.stories.scope} stories` : `${run.runId}: queued`;
  return (
    <a className={`seg-run seg-${run.state}`} data-state={run.state} data-run={run.runId} href={runHref(pack, run.stack, run.runId)} data-tip={tip} aria-label={tip}
       style={run.state === "running" ? { ["--filled" as string]: filled } : run.score !== null && run.total ? scoreStyle(run.score, run.total) : undefined}>
      {run.score !== null ? run.score : ""}
    </a>
  );
}

export function SeriesBar({ series, pack }: { series: Series; pack: string }) {
  return (
    <span className="series-bar" aria-label={`${series.done} of ${series.size} runs done`}>
      {series.runs.map((r) => <Segment key={r.runId} run={{ ...r, stack: series.stack } as SeriesRun & { stack: string }} pack={pack} stack={series.stack} />)}
    </span>
  );
}
