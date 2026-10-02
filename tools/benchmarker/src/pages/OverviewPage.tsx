// The overview (plan section 4.1): what is each machine doing, and how do the stacks compare. Sparse on purpose:
// each line links to the page that has the detail.
import type { ReactNode } from "react";
import type { Row, State } from "../../shared/types.ts";
import { nowLines } from "../../shared/overviewView.ts";
import { CombinationsTable } from "../components/CombinationsTable.tsx";
import { NowTable } from "../components/overview/NowTable.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import "./overview.css";
import "./machine.css";  // the "now" line, shared with the machines list

/** What the overview is given. App.tsx owns the header's choices (pack, version, the runs switch) and passes their
 * result; the page reads /api/machines itself, for reachability.
 *
 * - `state`: the whole state. "Now" comes from every machine and every run, whatever the header shows: a machine
 *   runs every pack.
 * - `serverNow`: the server's clock now (useBenchState); `state.now` stands in until it is known.
 * - `rows`: the runs of the pack and version family chosen in the header that the runs switch shows. The
 *   Combinations table is over these.
 * - `filteredOut`: what to say when the switch hides every run there is; left out when there are none at all. */
export interface OverviewPageProps {
  state: State;
  serverNow: number | null;
  rows: Row[];
  filteredOut?: ReactNode;
}

export function OverviewPage({ state, serverNow, rows, filteredOut }: OverviewPageProps) {
  const { reach } = useMachineList();
  const now = serverNow ?? state.now;
  const lines = nowLines(state.machines ?? [], state.rows, reach, now);
  return (
    <div className="page overview-page" data-page="overview">
      <NowTable lines={lines} />
      {rows.length ? <CombinationsTable rows={rows} /> : (
        <section className="ov-section" data-section="combinations">{filteredOut ?? <p className="empty-note">No runs for this pack and version.</p>}</section>
      )}
    </div>
  );
}
