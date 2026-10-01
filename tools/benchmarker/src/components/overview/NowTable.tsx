// "Now": one line per machine, what it runs or that it is idle, and its queue; each machine links to its page.
import type { NowLine } from "../../../shared/overviewView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { MachineLink } from "../EntityLinks.tsx";
import { NowSummary, QueueCount } from "../machine/NowSummary.tsx";

export function NowTable({ lines }: { lines: NowLine[] }) {
  return (
    <section className="ov-section now" data-section="now" aria-labelledby="h-now">
      <h2 id="h-now"><span className="term" data-tip={GLOSSARY.now.what}>{GLOSSARY.now.name}</span></h2>
      {lines.length === 0 ? <p className="empty-note">No machines: none answered, and none is in the list.</p> : (
        <table className="now-table" aria-label="Now">
          <thead>
            <tr>
              <th scope="col" data-tip={GLOSSARY.machineRow.what}>{GLOSSARY.machineRow.name}</th>
              <th scope="col" data-tip={GLOSSARY.nowRunning.what}>{GLOSSARY.nowRunning.name}</th>
              <th scope="col" data-tip={GLOSSARY.queue.what}>{GLOSSARY.queue.name}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.machine} data-machine={l.machine} data-state={l.state}>
                <th scope="row"><MachineLink machine={l.machine} /></th>
                <td><NowSummary line={l} /></td>
                <td className="q"><QueueCount line={l} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
