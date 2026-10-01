// One machine (plan section 4.6): what it is, what it is doing, and what it has run. It merges the machine's
// section of the old By-machine view with its card on the Machines tab.
import { useState } from "react";
import type { Row, RunStatus, State } from "../../shared/types.ts";
import { RUN_STATUSES } from "../../shared/types.ts";
import { machineHref, withParams } from "../../shared/routes.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { useMachineList } from "../components/machine/machineApi.ts";
import { MachineHeader } from "../components/machine/MachineHeader.tsx";
import { MachineNow } from "../components/machine/MachineNow.tsx";
import { MachineHistory } from "../components/machine/MachineHistory.tsx";
import "./machine.css";

/** The history's status filter rides in the address as ?hide=cancelled,failed. */
const HIDE = "hide";
const parseHidden = (v: string | undefined) => new Set((v ?? "").split(",").filter((s): s is RunStatus => (RUN_STATUSES as string[]).includes(s)));

/** `runs`: every run filed under this machine, in every pack and version (App.tsx: rows whose `machine` is it).
 * `state`: the whole state; the machine's jobs are found by its dbench node there. `params`: the address's query. */
export function MachinePage(props: MachinePageProps) {
  // Keyed by machine: moving to another machine's page starts from its own address, not this one's filter.
  return <MachineBody key={props.machine} {...props} />;
}

export interface MachinePageProps { machine: string; runs: Row[]; state: State; serverNow: number | null; params: Record<string, string> }

function MachineBody({ machine, runs, state, serverNow, params }: MachinePageProps) {
  const { machines } = useMachineList();
  const [hidden, setHidden] = useState<Set<RunStatus>>(() => parseHidden(params[HIDE]));
  const chooseHidden = (h: Set<RunStatus>) => {
    setHidden(h);
    // Into the address without a navigation: the page stays where it is scrolled.
    try { history.replaceState(null, "", withParams(machineHref(machine), { [HIDE]: [...h].join(",") })); } catch { /* the address just isn't updated */ }
  };
  const info = machines?.find((m) => m.name === machine);
  const isNode = Boolean(info) || (state.machines ?? []).some((m) => m.node === machine);
  const now = serverNow ?? state.now;
  return (
    <div className="page machine-page" data-page="machine" data-machine={machine}>
      <Breadcrumb trail={[{ label: machine }]} />
      <MachineHeader machine={machine} info={info} listed={machines !== undefined} runs={runs} all={state.rows} />
      <MachineNow machine={machine} all={state.rows} info={info} listed={machines !== undefined} isNode={isNode} node={(state.machines ?? []).find((m) => m.node === machine) ?? null} now={now} />
      <MachineHistory runs={runs} hidden={hidden} onHidden={chooseHidden} />
    </div>
  );
}
