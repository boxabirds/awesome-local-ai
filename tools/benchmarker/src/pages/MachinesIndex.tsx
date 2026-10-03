// The machines list (replaces the Machines tab's cards): one compact row per machine, linking to its page, with
// its hardware, what it is doing now and its queue; then "Add a machine".
import type { State } from "../../shared/types.ts";
import { nowLines } from "../../shared/overviewView.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import type { Route } from "../../shared/routes.ts";
import { Breadcrumb, MachineLink } from "../components/EntityLinks.tsx";
import { Missing } from "../components/run/bits.tsx";
import { hardware, hardwareShort, useMachineList } from "../components/machine/machineApi.ts";
import { NowSummary, QueueCount } from "../components/machine/NowSummary.tsx";
import { AddMachine } from "../components/machine/AddMachine.tsx";
import "./machine.css";

/** `state` and `serverNow` as the overview gets them (App.tsx). The page reads /api/machines itself. */
export interface MachinesIndexProps { route: Route; state: State; serverNow: number | null }

export function MachinesIndex({ route, state, serverNow }: MachinesIndexProps) {
  const { machines, reach } = useMachineList();
  const lines = nowLines(state.machines ?? [], state.rows, reach, serverNow ?? state.now);
  return (
    <div className="machines-index" data-page="machines">
      <Breadcrumb route={route} />
      <section className="mi-list" aria-labelledby="h-machines">
        <h2 id="h-machines"><span className="term" data-tip={GLOSSARY.machinesList.what}>{GLOSSARY.machinesList.name}</span><span className="small">{lines.length} · each links to its page: hardware, installs, jobs and history</span></h2>
        {lines.length === 0 ? <p className="empty-note">{machines ? "No machines yet." : "Loading the machines…"}</p> : (
          <table className="machines" aria-label="Machines">
            <thead>
              <tr>
                <th scope="col" data-tip={GLOSSARY.machineRow.what}>{GLOSSARY.machineRow.name}</th>
                <th scope="col" data-tip={GLOSSARY.hardware.what}>{GLOSSARY.hardware.name}</th>
                <th scope="col" data-tip={GLOSSARY.now.what}>{GLOSSARY.now.name}</th>
                <th scope="col" data-tip={GLOSSARY.queue.what}>{GLOSSARY.queue.name}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const node = machines?.find((m) => m.name === l.machine)?.node;
                return (
                  <tr key={l.machine} data-machine={l.machine} data-state={l.state}>
                    <th scope="row"><MachineLink machine={l.machine} /></th>
                    <td className="hw">{node ? <span data-tip={hardware(node)}>{hardwareShort(node) || hardware(node)}</span>
                      : <Missing why={machines ? "Not reported: the machine is unreachable." : "Waiting for the machine list."} />}</td>
                    <td><NowSummary line={l} /></td>
                    <td className="q"><QueueCount line={l} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <AddMachine />
    </div>
  );
}
