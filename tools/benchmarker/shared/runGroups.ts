// The one order runs are shown in, on every page: in progress, then queued, then finished, then those that ended
// without finishing. Each of those is a section a page can fold away (RunGroupHead).
import type { Row } from "./types.ts";

export type RunGroupId = "inProgress" | "queued" | "finished" | "ended";
export interface RunGroup { id: RunGroupId; label: string }

export const RUN_GROUPS: RunGroup[] = [
  { id: "inProgress", label: "In progress" },
  { id: "queued", label: "Queued" },
  { id: "finished", label: "Finished" },
  { id: "ended", label: "Did not finish" },
];

export function groupOfRun(row: Pick<Row, "status">): RunGroupId {
  switch (row.status) {
    case "running": return "inProgress";
    case "queued": return "queued";
    case "finished": return "finished";
    default: return "ended";
  }
}

const rankOf = (row: Row) => RUN_GROUPS.findIndex((g) => g.id === groupOfRun(row));
const byId = (a: Row, b: Row) => a.runId.localeCompare(b.runId, undefined, { numeric: true });
const queuePlace = (r: Row) => r.live?.queue?.position ?? 0;

/** In the order above; the queue in dbench's order, every other group by run id in natural order ("r2" before "r10"). */
export function runOrder(runs: Row[]): Row[] {
  return runs.toSorted((a, b) => rankOf(a) - rankOf(b) || (groupOfRun(a) === "queued" ? queuePlace(a) - queuePlace(b) : 0) || byId(a, b));
}

export interface RunSection<T> { group: RunGroup; items: T[] }

/** Anything that holds a run, put in runs' order and split into its sections; a group with nothing in it is left out. */
export function groupRuns<T>(items: T[], runOf: (item: T) => Row): RunSection<T>[] {
  const ordered = items.toSorted((a, b) => rankOf(runOf(a)) - rankOf(runOf(b)));   // stable: ties keep the order given
  return RUN_GROUPS.map((group) => ({ group, items: ordered.filter((i) => groupOfRun(runOf(i)) === group.id) })).filter((s) => s.items.length > 0);
}
