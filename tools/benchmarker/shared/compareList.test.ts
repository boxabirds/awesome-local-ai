// The list of runs a run page compares itself with: which runs can be chosen, how a choice is written in the address,
// how a typed search finds a run, and how the list is read back (some of it may name runs that are gone).
import { describe, expect, it } from "vitest";
import type { Row } from "./types.ts";
import { compareToken, comparableRuns, matchRuns, parseCompareList, resolveCompareList, serializeCompareList } from "./compareList.ts";

const SUITE = "vidi-v2.0-pre2";
const row = (stack: string, runId: string, over: Partial<Row> = {}): Row => ({
  pack: "vidi", stack, runId, suite: SUITE, label: stack.split("/").slice(-1)[0], machine: "tritus", state: "finished",
  stories: [{ id: "1" } as Row["stories"][number]], status: "finished" as Row["status"], ...over,
} as Row);

const GUFO = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
const me = row(GUFO, "v2-r2");

describe("comparableRuns: any run recorded in the same pack and suite, not only this combination's", () => {
  const rows = [
    me, row(GUFO, "v2-r1"), row(GUFO, "v2-r10"), row(MLX, "v2-r1"), row(MLX, "v2-r3"),
    row(GUFO, "v2-r9", { stories: [] }),                       // nothing recorded: nothing to compare
    row(GUFO, "v1-r1", { suite: "vidi-v1.1" }),                // a different suite: its stories are not these stories
    row(GUFO, "t-r1", { pack: "todoodle" }),                   // a different pack
  ];
  it("includes other combinations' runs, excludes itself, empty runs, other suites and other packs", () => {
    expect(comparableRuns(me, rows).map((r) => `${r.stack.split("/").pop()}:${r.runId}`))
      .toEqual(["gufo-pi:v2-r1", "gufo-pi:v2-r10", "mlxserve-pi:v2-r1", "mlxserve-pi:v2-r3"]);
  });
  it("puts this combination's runs first, then the others by combination, with run numbers in numeric order", () => {
    const ids = comparableRuns(me, [row(MLX, "v2-r10"), row(MLX, "v2-r2"), row(GUFO, "v2-r1"), me]).map((r) => r.runId);
    expect(ids).toEqual(["v2-r1", "v2-r2", "v2-r10"]);
  });
});

describe("the address: a bare run id is this combination's, anything else carries its combination", () => {
  it("writes a run of this combination as its run id and another as stack|run id", () => {
    expect(compareToken(me, row(GUFO, "v2-r4"))).toBe("v2-r4");
    expect(compareToken(me, row(MLX, "v2-r4"))).toBe(`${MLX}|v2-r4`);
  });
  it("round-trips a list", () => {
    const list = ["v2-r4", `${MLX}|v2-r1`];
    expect(parseCompareList(serializeCompareList(list))).toEqual(list);
  });
  it("reads nothing, blanks and repeats as the list they mean", () => {
    expect(parseCompareList(undefined)).toEqual([]);
    expect(parseCompareList("")).toEqual([]);
    expect(parseCompareList("none")).toEqual([]);              // the old 'chose no run' value
    expect(parseCompareList("v2-r4,,v2-r4, v2-r5")).toEqual(["v2-r4", "v2-r5"]);
  });
  it("an empty list is written as 'none', so the address can say 'none chosen' as opposed to 'not chosen yet'", () => {
    expect(serializeCompareList([])).toBe("none");
  });
});

describe("resolveCompareList: the runs a list names, in its order, and the names it cannot find", () => {
  const candidates = comparableRuns(me, [me, row(GUFO, "v2-r1"), row(GUFO, "v2-r4"), row(MLX, "v2-r1")]);
  it("keeps the list's order", () => {
    const { runs } = resolveCompareList(me, [`${MLX}|v2-r1`, "v2-r4"], candidates);
    expect(runs.map((r) => r.runId)).toEqual(["v2-r1", "v2-r4"]);
    expect(runs[0].stack).toBe(MLX);
  });
  it("reports a name that is not a candidate (a run since removed, or from another suite) and leaves it out", () => {
    const { runs, unknown } = resolveCompareList(me, ["v2-r4", "v2-r99", `${MLX}|v2-r7`], candidates);
    expect(runs.map((r) => r.runId)).toEqual(["v2-r4"]);
    expect(unknown).toEqual(["v2-r99", `${MLX}|v2-r7`]);
  });
});

describe("matchRuns: a search finds a run by any part of what identifies it", () => {
  const all = [row(GUFO, "v2-r1"), row(GUFO, "v2-gufo05-r3"), row(MLX, "v2-mlx26101-r3", { machine: "quintus", label: "3.8/flash-next mlxserve" })];
  it("matches on run id, label, combination and machine, ignoring case", () => {
    expect(matchRuns(all, "mlx26101").map((r) => r.runId)).toEqual(["v2-mlx26101-r3"]);
    expect(matchRuns(all, "QUINTUS").map((r) => r.runId)).toEqual(["v2-mlx26101-r3"]);
    expect(matchRuns(all, "strix").map((r) => r.runId)).toEqual(["v2-r1", "v2-gufo05-r3"]);
  });
  it("needs every word of the search to match, in any order", () => {
    expect(matchRuns(all, "r3 gufo").map((r) => r.runId)).toEqual(["v2-gufo05-r3"]);
    expect(matchRuns(all, "r3 mlx quintus").map((r) => r.runId)).toEqual(["v2-mlx26101-r3"]);
    expect(matchRuns(all, "r3 nothing")).toEqual([]);
  });
  it("an empty search offers everything, and runs already chosen are left out", () => {
    expect(matchRuns(all, "").length).toBe(3);
    expect(matchRuns(all, "  ").length).toBe(3);
    expect(matchRuns(all, "", new Set([`${GUFO}|v2-r1`])).map((r) => r.runId)).toEqual(["v2-gufo05-r3", "v2-mlx26101-r3"]);
  });
});
