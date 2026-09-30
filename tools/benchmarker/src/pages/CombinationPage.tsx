import type { Row, State } from "../../shared/types.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";

/** One combination: its runs side by side, story by story. (Being built: plan section 4.2.) */
export function CombinationPage({ stack, runs }: { stack: string; runs: Row[]; state: State; serverNow: number | null }) {
  const label = runs[0]?.label ?? stack;
  return (
    <div className="page combination-page" data-page="combination">
      <Breadcrumb trail={[{ label }]} />
      <h1>{label}</h1>
    </div>
  );
}
