import type { Machine, Row } from "./types.ts";

export interface MachineGroup {
  machine: string;
  /** dbench's view of the machine; null for a host no dbench node answered for. */
  info: Machine | null;
  rows: Row[];
}

/** Running first, then queued in the node's order, then everything else by stack and run. */
const rank = (r: Row) => (r.live?.status === "running" ? 0 : r.live?.status === "queued" ? 1 : 2);

function byWork(a: Row, b: Row): number {
  return rank(a) - rank(b)
    || (a.live?.queue?.position ?? 0) - (b.live?.queue?.position ?? 0)
    || a.stack.localeCompare(b.stack)
    || a.runId.localeCompare(b.runId, undefined, { numeric: true });
}

/** One group per machine: busy machines first, then the rest by name; idle dbench nodes included. */
export function groupByMachine(rows: Row[], machines: Machine[]): MachineGroup[] {
  const groups = new Map<string, Row[]>(machines.map((m) => [m.node, []]));
  for (const r of rows) groups.set(r.machine, [...(groups.get(r.machine) ?? []), r]);
  const info = new Map(machines.map((m) => [m.node, m]));
  const busy = (rs: Row[]) => Math.min(3, ...rs.map(rank));
  return [...groups.entries()]
    .map(([machine, rs]) => ({ machine, info: info.get(machine) ?? null, rows: rs.toSorted(byWork) }))
    .toSorted((a, b) => busy(a.rows) - busy(b.rows) || a.machine.localeCompare(b.machine));
}
