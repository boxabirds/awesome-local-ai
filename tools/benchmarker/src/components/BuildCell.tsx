import type { Live, Row } from "../../shared/types.ts";
import { ordinal, shortAction } from "../format.ts";

const MAX_AHEAD_SHOWN = 2;

function statusClass(build: string): string {
  const word = build.split(":")[0].split(" ")[0];
  return `s-${["running", "queued", "failed", "cancelled", "finished", "stopped"].includes(word) ? word : "queued"}`;
}

/** What the running story is doing, in numbers; a story that has only just started says so. */
function Progress({ live, serverNow }: { live: Live; serverNow: number | null }) {
  const fresh = !live.calls && !live.agentMinutes;
  const bits: string[] = [];
  if (fresh && live.storyStartedAt !== null && serverNow !== null) {
    const mins = Math.max(0, Math.round((serverNow - live.storyStartedAt) / 60));
    bits.push(`started ${mins > 0 ? `${mins} min ago` : "just now"}; first numbers within a minute`);
  } else if (!fresh) {
    if (live.agentMinutes !== null) bits.push(`${live.agentMinutes} agent-min`);
    if (live.calls !== null) bits.push(`${live.calls} calls`);
    if (live.outputTokens !== null) bits.push(`${Math.round(live.outputTokens / 1000)}k out`);
  }
  if (live.tasksTotal !== null) bits.push(`tasks ${live.tasksWritten}/${live.tasksTotal}`);
  if ((live.attempt ?? 1) > 1) bits.push(`attempt ${live.attempt}`);
  const action = live.lastActivity ? shortAction(live.lastActivity) : live.logTail.at(-1);
  return (
    <>
      {bits.length > 0 ? <div className="small">{bits.join(" · ")}</div> : null}
      {action ? <div className="log" title={action}>{action}</div> : null}
    </>
  );
}

export function BuildCell({ row, serverNow }: { row: Row; serverNow: number | null }) {
  const live = row.live;
  if (live?.status === "queued" && live.queue) {
    const { position, ahead } = live.queue;
    const shown = ahead.slice(0, MAX_AHEAD_SHOWN).join(", ");
    const more = ahead.length > MAX_AHEAD_SHOWN ? ` and ${ahead.length - MAX_AHEAD_SHOWN} more` : "";
    return (
      <>
        <div className="s-queued">queued: {ordinal(position)} on {row.node}</div>
        <div className="small">{ahead.length > 0 ? `after ${shown}${more}` : "next to start"}</div>
      </>
    );
  }
  return (
    <>
      <div className={statusClass(row.stages.build)}>{row.stages.build}</div>
      {live?.status === "running" ? <Progress live={live} serverNow={serverNow} /> : null}
      {live?.status !== "running" && row.stateAt ? <div className="small">{row.stateAt.replace("T", " ").replace("Z", " UTC")}</div> : null}
    </>
  );
}
