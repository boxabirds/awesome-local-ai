import type { Row, StorySquare } from "../../shared/types.ts";
import { qualityClass } from "../format.ts";

const LABEL: Record<StorySquare["state"], string> = {
  ok: "all its flows pass", part: "some flows pass", bad: "no flows pass", unbuilt: "not built yet", running: "being built now",
};

const title = (q: StorySquare) =>
  `story ${q.id}: ${LABEL[q.state]}${q.total ? ` (${q.passed}/${q.total} hidden flows)` : ""}, against the latest build`;

/** How many of the run's stories pass all their held-out tests against its latest build, and one square per
 * story in scope. */
export function StoriesWorkingCell({ row }: { row: Row }) {
  const { working, scope, squares } = row.storiesWorking;
  const built = squares.filter((q) => q.state !== "unbuilt" && q.state !== "running").length;
  if (!squares.some((q) => q.state !== "unbuilt")) return <span className="wait">—</span>;
  return (
    <>
      <div>
        <strong className={`num-l ${qualityClass(built ? working / built : null)}`} data-tip={`${working} of the ${built} stories built so far pass all their held-out tests; the colour judges those, not the ${scope - built} still to build`}>{working}</strong> <span className="small">of {scope} pass</span>
      </div>
      <div className="strip">
        {squares.map((q) => <span key={q.id} className={`cell q-${q.state}`} data-tip={title(q)} data-story={q.id} data-state={q.state} />)}
      </div>
    </>
  );
}
