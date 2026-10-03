// Observations: facts about the work, found in the data of normal operation, most actionable first. Never a bug of the
// app, the harness or the pipeline, never a cause or an instruction (CLAUDE.md, "The app shows results, never its own faults").
import type { Observation } from "../../../shared/dashboardView.ts";
import { machineHref, runHref, storyRunHref } from "../../../shared/routes.ts";

const hrefOf = (o: Observation) => (o.run ? (o.run.story ? storyRunHref(o.run.pack, o.run.stack, o.run.runId, o.run.story) : runHref(o.run.pack, o.run.stack, o.run.runId)) : machineHref(o.machine));

export function Observations({ items, machines }: { items: Observation[]; machines: number }) {
  if (machines === 0) return null;
  return (
    <section className="ov-section observations" data-section="observations" aria-labelledby="h-observations">
      <h2 id="h-observations">Observations</h2>
      {items.length === 0 ? <p className="obs-none">Every machine is working.</p> : (
        <ul className="obs-list">
          {items.map((o, i) => (
            <li key={`${o.kind}-${o.machine}-${i}`} data-kind={o.kind} className={`obs obs-${o.kind}`}>
              <a href={hrefOf(o)}>{o.text}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
