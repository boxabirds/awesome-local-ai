import { describe, expect, it } from "vitest";
import { groupOfRun, groupRuns, RUN_GROUPS, runOrder } from "./runGroups.ts";
import type { Row, RunStatus } from "./types.ts";

const run = (runId: string, status: RunStatus, position?: number): Row =>
  ({ runId, status, live: position === undefined ? null : { status, queue: { position, ahead: [] } } }) as unknown as Row;

describe("the order runs are shown in, everywhere", () => {
  it("in progress, then queued, then finished, then the rest", () => {
    expect(RUN_GROUPS.map((g) => g.id)).toEqual(["inProgress", "queued", "finished", "ended"]);
  });

  it.each([["running", "inProgress"], ["queued", "queued"], ["finished", "finished"], ["failed", "ended"], ["stopped", "ended"], ["cancelled", "ended"], ["unknown", "ended"]] as [RunStatus, string][])(
    "a %s run is in group %s", (status, group) => expect(groupOfRun(run("r", status))).toBe(group));

  it("runOrder: running before queued before finished before the rest", () => {
    const rs = [run("v2-r1", "finished"), run("v2-r2", "cancelled"), run("v2-r3", "queued", 2), run("v2-r4", "running"), run("v2-r5", "failed")];
    expect(runOrder(rs).map((r) => r.runId)).toEqual(["v2-r4", "v2-r3", "v2-r1", "v2-r2", "v2-r5"]);
  });

  it("within a group: run id in natural order, so r2 comes before r10", () => {
    const rs = [run("v2-r10", "finished"), run("v2-r9", "finished"), run("v2-r2", "finished")];
    expect(runOrder(rs).map((r) => r.runId)).toEqual(["v2-r2", "v2-r9", "v2-r10"]);
  });

  it("the queue is in dbench's order, not by run id", () => {
    const rs = [run("v2-r1", "queued", 3), run("v2-r2", "queued", 1), run("v2-r3", "queued", 2)];
    expect(runOrder(rs).map((r) => r.runId)).toEqual(["v2-r2", "v2-r3", "v2-r1"]);
  });

  it("does not change what it is given", () => {
    const rs = [run("b", "finished"), run("a", "running")];
    runOrder(rs);
    expect(rs.map((r) => r.runId)).toEqual(["b", "a"]);
  });
});

describe("grouping runs into sections", () => {
  const rs = [run("v2-r1", "finished"), run("v2-r2", "running"), run("v2-r3", "queued", 1), run("v2-r4", "finished"), run("v2-r5", "cancelled")];

  it("one section per group that has a run, in order, each in run order; empty groups are left out", () => {
    const g = groupRuns(rs, (r) => r);
    expect(g.map((s) => [s.group.id, s.items.map((r) => r.runId)])).toEqual([
      ["inProgress", ["v2-r2"]], ["queued", ["v2-r3"]], ["finished", ["v2-r1", "v2-r4"]], ["ended", ["v2-r5"]],
    ]);
  });

  it("works on things that hold a run", () => {
    const g = groupRuns(rs.map((run) => ({ run, n: 1 })), (x) => x.run);
    expect(g[0].items[0].run.runId).toBe("v2-r2");
  });

  it("nothing: no sections", () => expect(groupRuns([], (r: Row) => r)).toEqual([]));
});
