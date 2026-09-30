import type { Row, State } from "../../shared/types.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";

/** One machine: what it is, what it's doing, what it has run. (Being built: plan section 4.6.) */
export function MachinePage({ machine }: { machine: string; runs: Row[]; state: State; serverNow: number | null; params: Record<string, string> }) {
  return (
    <div className="page machine-page" data-page="machine">
      <Breadcrumb trail={[{ label: machine }]} />
      <h1>{machine}</h1>
    </div>
  );
}
