import type { MachineGroup } from "../../shared/grouping.ts";
import type { Machine, State } from "../../shared/types.ts";
import { RunRow } from "./RunRow.tsx";

interface Props {
  group: MachineGroup; state: State; serverNow: number | null;
  /** The flows every shown score is out of ("Score / 75"); null if they differ or there are none. */
  scoreTotal: number | null;
}

const COLUMNS: [string, string][] = [
  ["Run", "12%"], ["Status", "9%"], ["Story", "11%"], ["Time", "9%"], ["Activity", "11%"],
  ["Stories passing held-out tests", "11%"], ["Tokens", "8%"], ["tok/s", "8%"], ["Score", "7%"], ["Judge", "7%"], ["Links", "7%"],
];

/** What a dbench node is doing now: its running job, or idle, and the length of its queue. */
function NodeStatus({ info }: { info: Machine }) {
  const r = info.running;
  return (
    <span className="machine-status">
      {r ? (
        <span className="s-running">
          running {r.short} {r.runId}
          {r.story ? ` · story ${r.story}${r.finishing ? " (finishing)" : ""}` : " · starting"}
          {r.agentMinutes ? ` · ${Math.round(r.agentMinutes)} agent-min` : ""}
        </span>
      ) : (
        <span className="idle">idle</span>
      )}
      <span className="small">{info.queued ? `${info.queued} queued` : "nothing queued"}</span>
    </span>
  );
}

/** One machine and every run on it: the running one, its queue in order, then finished runs. */
export function MachineSection({ group, state, serverNow, scoreTotal }: Props) {
  const host = group.rows.find((r) => r.host && r.host !== group.machine)?.host;
  return (
    <section data-machine={group.machine}>
      <h2>
        <span className="machine-name">{group.machine}</span>
        {host ? <span className="small">{host}</span> : null}
        {group.info ? <NodeStatus info={group.info} /> : null}
      </h2>
      {group.rows.length === 0 ? null : (
        <table>
          <colgroup>{COLUMNS.map(([name, width]) => <col key={name} style={{ width }} />)}</colgroup>
          <thead>
            <tr>{COLUMNS.map(([name]) => <th key={name}>{name === "Score" && scoreTotal ? `Score / ${scoreTotal}` : name}</th>)}</tr>
          </thead>
          <tbody>
            {group.rows.map((r) => <RunRow key={`${r.stack}:${r.runId}:${r.live?.jobId ?? ""}`} row={r} state={state} serverNow={serverNow} columns={COLUMNS.length} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}
