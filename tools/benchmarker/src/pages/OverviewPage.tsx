// The overview (plan section 4.1): what is each machine doing, and how do the stacks compare. Sparse on purpose:
// each line links to the page that has the detail.
import type { Row, RunStatus, State } from "../../shared/types.ts";
import { nowLines } from "../../shared/overviewView.ts";
import { CombinationsTable } from "../components/CombinationsTable.tsx";
import { NowTable } from "../components/overview/NowTable.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import "./overview.css";
import "./machine.css";  // the "now" line, shared with the machines list

/** What the overview is given. App.tsx owns the header's choices (pack, version, status filter) and passes their
 * result; the page reads /api/machines itself, for reachability.
 *
 * - `state`: the whole state. "Now" comes from every machine and every run, whatever the header shows: a machine
 *   runs every pack.
 * - `serverNow`: the server's clock now (useBenchState); `state.now` stands in until it is known.
 * - `rows`: the runs of the pack and version family chosen in the header, *before* the status filter.
 * - `hidden`: the statuses the header's status filter hides. It applies to the Combinations table (as today: the
 *   table's heading says the filters decide which runs it is over). Leave it out to hide nothing. */
export interface OverviewPageProps {
  state: State;
  serverNow: number | null;
  rows: Row[];
  hidden?: ReadonlySet<RunStatus>;
}

export function OverviewPage({ state, serverNow, rows, hidden }: OverviewPageProps) {
  const { reach } = useMachineList();
  const now = serverNow ?? state.now;
  const lines = nowLines(state.machines ?? [], state.rows, reach, now);
  const ranked = hidden?.size ? rows.filter((r) => !hidden.has(r.status)) : rows;
  return (
    <div className="page overview-page" data-page="overview">
      <NowTable lines={lines} />
      {ranked.length ? <CombinationsTable rows={ranked} /> : (
        <section className="ov-section" data-section="combinations"><p className="empty-note">No runs for this pack, version and status.</p></section>
      )}
    </div>
  );
}
