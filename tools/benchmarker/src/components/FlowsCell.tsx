import type { Row } from "../../shared/types.ts";

const EXPLAIN =
  "Hidden user flows (held-out tests the agent never sees) passing against the app as built so far, " +
  "out of every flow in the run's scope. Checked after each story; a drop means a story broke earlier work.";

const STATE_CLASS = { none: "wait", working: "f-ok", "some failing": "f-part", regressed: "f-bad", broken: "f-bad" } as const;

/** How many of the scope's hidden flows work now, out of a fixed total, and a word for how that is going. */
export function FlowsCell({ row }: { row: Row }) {
  const { state, passed, after, was } = row.flows;
  if (state === "none" || passed === null) return <span className="wait">—</span>;
  const total = row.flowsTotal;
  return (
    <div title={EXPLAIN}>
      <div>
        <strong>{passed}</strong>{total ? ` of ${total}` : ""}
      </div>
      {total ? (
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={passed} aria-label="flows working">
          <span style={{ width: `${Math.min(100, (100 * passed) / total)}%` }} />
        </div>
      ) : null}
      <div className={`small ${STATE_CLASS[state]}`}>
        {state}{was !== null ? ` (was ${was})` : ""} · after story {after}
      </div>
    </div>
  );
}
