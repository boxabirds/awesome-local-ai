// The overview (plan section 4.1): does anything need me, what is each machine doing, and how do the stacks
// compare. Sparse on purpose: each line links to the page that has the detail.
import type { Row, RunStatus, State } from "../../shared/types.ts";
import { needsYou, nowLines } from "../../shared/overviewView.ts";
import { CombinationsTable } from "../components/CombinationsTable.tsx";
import { NeedsYou } from "../components/overview/NeedsYou.tsx";
import { NowTable } from "../components/overview/NowTable.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import "./overview.css";
import "./machine.css";  // the "now" line, shared with the machines list

/** What the overview is given. App.tsx owns the header's choices (pack, version, status filter) and passes their
 * result; the page reads /api/machines itself, for reachability.
 *
 * - `state`: the whole state. "Now", idle and unreachable machines, and stuck stories come from every machine and
 *   every run, whatever the header shows: a machine runs every pack.
 * - `serverNow`: the server's clock now (useBenchState); `state.now` stands in until it is known.
 * - `rows`: the runs of the pack and version family chosen in the header, *before* the status filter. The run
 *   exceptions (failed or stopped, unscored, re-score fault, accounting) are over these, and never filtered by
 *   status: an exception is never hidden.
 * - `hidden`: the statuses the header's status filter hides. It applies to the Combinations table only (as today:
 *   the table's heading says the filters decide which runs it is over). Leave it out to hide nothing.
 * - `context`: how the header's choice is named in "Needs you" ("vidi · vidi-v2"); defaults to the rows' pack. */
export interface OverviewPageProps {
  state: State;
  serverNow: number | null;
  rows: Row[];
  hidden?: ReadonlySet<RunStatus>;
  context?: string;
}

export function OverviewPage({ state, serverNow, rows, hidden, context }: OverviewPageProps) {
  const { reach } = useMachineList();
  const now = serverNow ?? state.now;
  const machines = state.machines ?? [];
  const needs = needsYou({ rows, all: state.rows, machines, reach, now });
  const lines = nowLines(machines, state.rows, reach, now);
  const ranked = hidden?.size ? rows.filter((r) => !hidden.has(r.status)) : rows;
  const named = context ?? [...new Set(rows.map((r) => r.pack))].join(", ");
  return (
    <div className="page overview-page" data-page="overview">
      <div className="ov-top">
        <NeedsYou needs={needs} now={now} context={named || "none shown"} />
        <NowTable lines={lines} />
      </div>
      {ranked.length ? <CombinationsTable rows={ranked} /> : (
        <section className="ov-section" data-section="combinations"><p className="empty-note">No runs for this pack, version and status.</p></section>
      )}
    </div>
  );
}
