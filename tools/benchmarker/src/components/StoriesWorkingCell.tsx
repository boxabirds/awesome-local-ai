import type { Row, StorySquare } from "../../shared/types.ts";

const LABEL: Record<StorySquare["state"], string> = {
  ok: "all its flows pass", part: "some flows pass", bad: "no flows pass", unbuilt: "not built yet", running: "being built now",
};

const title = (q: StorySquare) =>
  `story ${q.id}: ${LABEL[q.state]}${q.total ? ` (${q.passed}/${q.total} hidden flows)` : ""}, against the latest build`;

/** How many of the run's stories pass all their held-out tests against its latest build, and one square per
 * story in scope. */
export function StoriesWorkingCell({ row }: { row: Row }) {
  const { working, scope, squares } = row.storiesWorking;
  if (!squares.some((q) => q.state !== "unbuilt")) return <span className="wait">—</span>;
  return (
    <>
      <div>
        <strong>{working}</strong> of {scope} pass
      </div>
      <div className="strip">
        {squares.map((q) => <span key={q.id} className={`cell q-${q.state}`} title={title(q)} data-story={q.id} data-state={q.state} />)}
      </div>
    </>
  );
}
