import type { Row } from "../../shared/types.ts";
import { shortAction } from "../format.ts";

const TOKENS_PER_K = 1000;

/** What the running story's agent has done: calls, tokens, tasks, and its latest action. */
export function ActivityCell({ row }: { row: Row }) {
  const live = row.live;
  if (row.status !== "running" || !live) return <span className="wait">—</span>;
  const fresh = !live.calls && !live.agentMinutes;
  const bits: string[] = [];
  if (fresh) bits.push("first numbers within a minute");
  else {
    // Zero after the story has run means not counted yet (Claude runs are counted at the story's end), not none.
    if (live.calls) bits.push(`${live.calls} calls`);
    if (live.outputTokens) bits.push(`${Math.round(live.outputTokens / TOKENS_PER_K)}k out`);
  }
  if (live.tasksTotal !== null) bits.push(`tasks ${live.tasksWritten}/${live.tasksTotal}`);
  const action = live.lastActivity ? shortAction(live.lastActivity) : live.logTail.at(-1);
  return (
    <>
      <div className="small">{bits.join(" · ")}</div>
      {action ? <div className="log" data-tip={action}>{action}</div> : null}
    </>
  );
}
