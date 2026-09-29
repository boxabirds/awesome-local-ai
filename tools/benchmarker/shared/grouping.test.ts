import { describe, expect, it } from "vitest";
import { groupByMachine } from "./grouping.ts";
import type { Machine, Row } from "./types.ts";

const row = (machine: string, stack: string, runId: string, status: string | null, position?: number) =>
  ({ machine, stack, runId, live: status ? { status, queue: position ? { position, ahead: [] } : null } : null }) as unknown as Row;
const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const Q27 = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";

describe("groupByMachine", () => {
  it("gives each machine one section: running, then its queue in order, then finished runs", () => {
    const machines: Machine[] = [
      { node: "gruntus", running: null, queued: 0 },
      { node: "tritus", running: null, queued: 0 },
    ];
    const groups = groupByMachine([
      row("gruntus", SWIFT, "smoke-v2-01", "done"),
      row("gruntus", Q27, "v2-r1", "queued", 4),
      row("gruntus", SWIFT, "v2-r2", "queued", 2),
      row("gruntus", SWIFT, "v2-r1", "running"),
      row("Apple M2 16GB", "reference/opus-5.5", "run-2", null),
    ], machines);
    expect(groups.map((g) => g.machine)).toEqual(["gruntus", "Apple M2 16GB", "tritus"]);
    expect(groups[0].rows.map((r) => `${r.stack === SWIFT ? "swift" : "27b"} ${r.runId}`)).toEqual([
      "swift v2-r1", "swift v2-r2", "27b v2-r1", "swift smoke-v2-01",
    ]);
    expect(groups[2]).toMatchObject({ machine: "tritus", rows: [] }); // an idle node still has its section
  });
});
