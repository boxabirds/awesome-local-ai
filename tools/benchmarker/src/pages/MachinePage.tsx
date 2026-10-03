// One machine (plan section 4.6): what it is, what it is doing, and what it has run. It merges the machine's
// section of the old By-machine view with its card on the Machines tab.
import type { ReactNode } from "react";
import type { Row, State } from "../../shared/types.ts";
import type { Route } from "../../shared/routes.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import { MachineHeader } from "../components/machine/MachineHeader.tsx";
import { MachineNow } from "../components/machine/MachineNow.tsx";
import { MachineHistory } from "../components/machine/MachineHistory.tsx";
import "./machine.css";

/** `runs`: every run filed under this machine, in every pack and version (App.tsx: rows whose `machine` is it).
 * `history`: those of them the header's runs switch shows; `filteredOut`: what the history says when the switch
 * hides them all. `state`: the whole state; the machine's jobs are found by its dbench node there. */
export interface MachinePageProps { route: Route; machine: string; runs: Row[]; history: Row[]; filteredOut: ReactNode; state: State; serverNow: number | null }

export function MachinePage({ route, machine, runs, history, filteredOut, state, serverNow }: MachinePageProps) {
  const { machines } = useMachineList();
  const info = machines?.find((m) => m.name === machine);
  const isNode = Boolean(info) || (state.machines ?? []).some((m) => m.node === machine);
  const now = serverNow ?? state.now;
  return (
    <div className="page machine-page" data-page="machine" data-machine={machine}>
      <Breadcrumb route={route} />
      <MachineHeader machine={machine} info={info} listed={machines !== undefined} runs={runs} all={state.rows} />
      <MachineNow machine={machine} all={state.rows} info={info} listed={machines !== undefined} isNode={isNode} node={(state.machines ?? []).find((m) => m.node === machine) ?? null} now={now} />
      <MachineHistory runs={history} filteredOut={runs.length > history.length ? filteredOut : undefined} />
    </div>
  );
}
