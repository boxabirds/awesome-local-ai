import type { Row } from "../../shared/types.ts";
import { duration } from "../format.ts";

const SECONDS_PER_MINUTE = 60;

/** Running: agent time on this story and how long the run has gone. Otherwise: agent time over its stories. */
export function TimeCell({ row, serverNow }: { row: Row; serverNow: number | null }) {
  const live = row.live;
  if (row.status === "running" && live) {
    const onStory = live.agentMinutes ? `${Math.round(live.agentMinutes)} min on this story` : "";
    const run = live.runStartedAt !== null && serverNow !== null ? `run ${duration(serverNow - live.runStartedAt)}` : "";
    if (!onStory && !run) return <span className="wait">—</span>;
    return (
      <>
        {onStory ? <div>{onStory}</div> : null}
        {run ? <div className="small">{run}</div> : null}
      </>
    );
  }
  if (live?.totalAgentMinutes && row.status !== "queued") {
    return <div>{duration(live.totalAgentMinutes * SECONDS_PER_MINUTE)} <span className="small">agent time</span></div>;
  }
  return <span className="wait">—</span>;
}
