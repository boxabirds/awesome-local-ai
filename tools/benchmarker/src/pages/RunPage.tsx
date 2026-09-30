import type { Row, State } from "../../shared/types.ts";
import { Breadcrumb, CombinationLink } from "../components/EntityLinks.tsx";

/** Everything about one run. (Being built: see plans/20260930-benchmarker-information-architecture.md, 4.3.) */
export function RunPage({ run }: { run: Row; state: State; serverNow: number | null }) {
  return (
    <div className="page run-page" data-page="run">
      <Breadcrumb trail={[{ label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> }, { label: run.runId }]} />
      <h1>{run.label} <b>{run.runId}</b></h1>
    </div>
  );
}
