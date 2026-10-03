// The overview, as a dashboard (specs/general/UI-IMPROVEMENTS-overview-dashboard.md): what are my machines doing, and what
// is worth noticing. Observations (facts about the work), a card per machine, the series of runs in progress, the score
// of record as a picture, then the Combinations table with every figure. Each item links to the page with the detail.
import type { ReactNode } from "react";
import type { Row, State } from "../../shared/types.ts";
import { nowLines } from "../../shared/overviewView.ts";
import { observations, scorePlot, seriesOf } from "../../shared/dashboardView.ts";
import { CombinationsTable } from "../components/CombinationsTable.tsx";
import { MachineCards } from "../components/overview/MachineCards.tsx";
import { Observations } from "../components/overview/Observations.tsx";
import { ScorePlot } from "../components/overview/ScorePlot.tsx";
import { SeriesRows } from "../components/overview/SeriesRows.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import "./overview.css";
import "./machine.css";  // the "now" line, shared with the machines list

/** What the overview is given. App.tsx owns the header's choices (pack, version, the runs switch) and passes their
 * result; the page reads /api/machines itself, for reachability.
 *
 * - `state`: the whole state. "Now" comes from every machine and every run, whatever the header shows: a machine
 *   runs every pack.
 * - `serverNow`: the server's clock now (useBenchState); `state.now` stands in until it is known.
 * - `inScope`: the runs of the pack and version family chosen in the header, whatever the runs switch shows: the
 *   series of runs in progress are drawn from these, so a switch to complete runs doesn't hide a queue.
 * - `rows`: those the runs switch shows. The score plot and the Combinations table are over these.
 * - `filteredOut`: what to say when the switch hides every run there is; left out when there are none at all. */
export interface OverviewPageProps {
  state: State;
  serverNow: number | null;
  rows: Row[];
  inScope?: Row[];
  filteredOut?: ReactNode;
}

export function OverviewPage({ state, serverNow, rows, inScope, filteredOut }: OverviewPageProps) {
  const { reach } = useMachineList();
  const now = serverNow ?? state.now;
  const lines = nowLines(state.machines ?? [], state.rows, reach, now);
  const notable = observations(lines, state.rows, now);
  const pack = (inScope ?? rows)[0]?.pack ?? "";
  return (
    <div className="page overview-page" data-page="overview">
      <Observations items={notable} machines={lines.length} />
      <MachineCards lines={lines} rows={state.rows} now={now} />
      <div className="ov-pair">
        <SeriesRows series={seriesOf(inScope ?? rows)} pack={pack} />
        <ScorePlot plot={scorePlot(rows)} />
      </div>
      {rows.length ? <CombinationsTable rows={rows} /> : (
        <section className="ov-section" data-section="combinations">{filteredOut ?? <p className="empty-note">No runs for this pack and version.</p>}</section>
      )}
    </div>
  );
}
