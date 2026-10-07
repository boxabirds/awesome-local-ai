// What the model server held in memory as each story of the run began: the weights, the total, and what the engine
// itself says of its prompt cache. Measurements only. Where a run has no snapshot at all the section is not drawn,
// and where one figure was not read it is "—", never 0; an engine says only what it says, so a cache figure it does
// not give is "—" too.
import type { Row } from "../../../shared/types.ts";
import { runMemory } from "../../../shared/runView.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { Missing, Section, Stat, Term } from "./bits.tsx";

const NOT_READ = "This figure was not read for this story.";
const NOT_GIVEN = "This engine does not give this figure.";

const gib = (n: number) => `${n.toFixed(1)} GiB`;

export function RunMemory({ run }: { run: Row }) {
  const v = runMemory(run);
  if (!v) return null;
  const or = (n: number | null) => (n === null ? <Missing why={NOT_READ} /> : gib(n));
  return (
    <Section term="runMemory" id="memory" aside={<span className="small">at the start of each story</span>}>
      <div className="stats">
        <Stat term="memoryWeights">{or(v.weightsGib)}</Stat>
        <Stat term="memoryPeak">{or(v.peakGib)}</Stat>
        <Stat term="memoryMedian">{or(v.medianGib)}</Stat>
      </div>
      <div className="table-scroll">
        <table className="rp-table memory-table" aria-label="Memory at the start of each story">
          <thead>
            <tr>
              <th>Story</th>
              <th className="n"><Term id="memoryResident" /></th>
              <th><Term id="promptCache" /></th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.id} data-story={r.id}>
                <td><StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>{r.id}</StoryRunLink></td>
                <td className="n resident">{or(r.residentGib)}</td>
                <td className="cache">{r.cache ?? <Missing why={NOT_GIVEN} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
