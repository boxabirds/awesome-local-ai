import type { MachineGroup } from "../../shared/grouping.ts";
import type { Machine, State } from "../../shared/types.ts";
import { RunRow } from "./RunRow.tsx";
import { comboStats } from "../../shared/stats.ts";
import type { Row } from "../../shared/types.ts";

const HOUR_DECIMALS = 1;
const PERCENT = 100;

interface Props {
  group: MachineGroup; state: State; serverNow: number | null;
  /** The flows every shown score is out of ("Score / 75"); null if they differ or there are none. */
  scoreTotal: number | null;
}

/** Each column: heading, width, and what the heading's hover says. */
const COLUMNS: [string, string, string][] = [
  ["Run", "12%", "The run: its model and engine, its run id, and the spec and suite version it was built against. Click it for one line per story."],
  ["Status", "9%", "Where the run is: running, queued (with its place on the machine), finished, failed, stopped or cancelled, and why."],
  ["Story", "11%", "The story being built, out of the run's scope, with its title; for other runs, how many stories were built."],
  ["Time", "9%", "Running: minutes on this story and how long the run has gone. Otherwise the agent time over its stories."],
  ["Activity", "11%", "The running story's tool calls, output tokens, tasks, and the agent's latest action."],
  ["Stories passing held-out tests", "11%", "How many of the run's stories pass all their held-out tests (hidden from the agent) on its latest build; one square per story: green all pass, amber some, red none, grey not built, blue being built."],
  ["Tokens", "8%", "Output tokens over the recorded stories; under it everything the model read (input plus cache) and its tool calls."],
  ["tok/s", "8%", "Output tokens over the time the stories took (model, tools and all). The per-story table has the model-only decode rate where it was timed."],
  ["Score", "7%", "The score of record: held-out tests passing in the re-score of the finished run's final build, under the current suite."],
  ["Judge", "7%", "Judge → opens the run in the review page, to check the automated verdicts against the recordings, once it is scored and has its history."],
  ["Links", "7%", "The run's record and summary on GitHub."],
];

const EXPLAIN = {
  hours: "Agent hours per story: the time the agent spent on each recorded story, averaged over every story of the runs shown. How long this combination takes to deliver a story; lower is faster, whatever the tokens per second.",
  quality: "Held-out quality: held-out tests passing over all held-out tests, across every built story of every run shown, each on its run's latest build. 100% means everything built works as the hidden tests check it. The quality measure to rank combinations by.",
};

/** A machine's rows by combination, in the order each first appears (the machine's order: running, queue, ended). */
function byCombination(rows: Row[]): [string, Row[]][] {
  const out = new Map<string, Row[]>();
  for (const r of rows) out.set(r.stack, [...(out.get(r.stack) ?? []), r]);
  return [...out.entries()];
}

/** A combination's heading row in a machine's table: its name, how many runs, and its two headline numbers. */
function ComboHead({ stack, rows, span }: { stack: string; rows: Row[]; span: number }) {
  const s = comboStats(rows);
  return (
    <tr className="combo-head" data-stack={stack}>
      <td colSpan={span}>
        <span className="stack-label" title={stack}>{rows[0].label}</span>
        <span className="small">{s.runs} run{s.runs === 1 ? "" : "s"}</span>
        <span>{s.hoursPerStory === null ? "—" : `${s.hoursPerStory.toFixed(HOUR_DECIMALS)} h per story`} <span className="explain" title={EXPLAIN.hours}>?</span></span>
        <span>held-out quality {s.quality === null ? "—" : `${Math.round(s.quality * PERCENT)}%`} <span className="explain" title={EXPLAIN.quality}>?</span></span>
      </td>
    </tr>
  );
}

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
            <tr>{COLUMNS.map(([name, , title]) => <th key={name} title={title}>{name === "Score" && scoreTotal ? `Score / ${scoreTotal}` : name}</th>)}</tr>
          </thead>
          {byCombination(group.rows).map(([stack, rows]) => (
            <tbody key={stack}>
              <ComboHead stack={stack} rows={rows} span={COLUMNS.length} />
              {rows.map((r) => <RunRow key={`${r.stack}:${r.runId}:${r.live?.jobId ?? ""}`} row={r} state={state} serverNow={serverNow} columns={COLUMNS.length} />)}
            </tbody>
          ))}
        </table>
      )}
    </section>
  );
}
