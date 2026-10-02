import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchIndex, type SearchItem } from "./search.ts";
import type { Live, Machine, Row, RunStatus, Story, StorySquare } from "./types.ts";

// MECE by what search does: building the index (one entry per combination, run, story, machine, deduped and
// grouped the way the app itself is organised), and searching it (every token must match, title outranks
// subtitle, grouped by section in information-architecture order, ranked by relevance inside each group).

// ---------- builders (same shape as storyView.test.ts's) ----------

function story(id: string, title: string): Story {
  return { id, title, status: "DONE", passed: null, total: null, ownPassed: 10, ownTotal: 10, usage: null, conversation: null };
}
let seq = 0;
interface RunOpts { status?: RunStatus; runId?: string; stack?: string; label?: string; machine?: string; host?: string; pack?: string }
function row(stories: Story[], o: RunOpts = {}): Row {
  const squares: StorySquare[] = stories.map((s) => ({ id: s.id, state: "ok", passed: s.ownPassed, total: s.ownTotal }));
  return {
    pack: o.pack ?? "vidi", family: "v2", stack: o.stack ?? "a/stack", label: o.label ?? "A label", runId: o.runId ?? `r${++seq}`,
    status: o.status ?? "finished", suite: "v2", scores: {}, stories, machine: o.machine ?? "node-a", host: o.host ?? "",
    statusNote: "", stateAt: "", storiesWorking: { working: 0, scope: squares.length, squares },
    live: null, usage: { tokS: null }, jobs: [], interventions: [], dir: null, node: null, client: "", packVersion: "v2", judgeReady: false, rescues: [],
  } as unknown as Row;
}
function machine(node: string, o: Partial<Machine> = {}): Machine {
  return { node, running: null, busy: false, queued: 0, ...o };
}

// ---------- buildSearchIndex ----------

describe("buildSearchIndex", () => {
  it("one combination per distinct pack+stack, even with several runs", () => {
    const rows = [row([], { stack: "a/stack", runId: "r1" }), row([], { stack: "a/stack", runId: "r2" }), row([], { stack: "b/stack", runId: "r3" })];
    const combos = buildSearchIndex({ rows, machines: [] }).filter((i) => i.section === "Combinations");
    expect(combos.map((c) => c.title)).toEqual(["A label", "A label"]); // same label; distinguished by stack in the id
    expect(new Set(combos.map((c) => c.id)).size).toBe(2);
  });

  it("one run per row, titled by its run id, with its combination and machine in the subtitle", () => {
    const rows = [row([], { runId: "v2-r3", label: "Swift 1.5", machine: "gruntus", host: "RTX 4090" })];
    const runs = buildSearchIndex({ rows, machines: [] }).filter((i) => i.section === "Runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ title: "v2-r3", subtitle: "Swift 1.5 · gruntus (RTX 4090)", href: expect.stringContaining("v2-r3") });
  });

  it("one story per distinct id within a pack; a story with no title anywhere is left out", () => {
    const rows = [
      row([story("1", "Pan and zoom"), story("2", "")], { pack: "vidi" }),
      row([story("1", "Pan and zoom")], { pack: "todoodle" }),
    ];
    const stories = buildSearchIndex({ rows, machines: [] }).filter((i) => i.section === "Stories");
    expect(stories).toHaveLength(2); // vidi story 1, todoodle story 1; vidi story 2 has no title and is skipped
    expect(stories.find((s) => s.subtitle.startsWith("todoodle"))?.title).toBe("Pan and zoom");
  });

  it("one machine per entry, with its current state as the subtitle", () => {
    const machines = [
      machine("gruntus", { running: { stack: "a/stack", short: "A", runId: "r1", story: "2", finishing: false, agentMinutes: 5 } }),
      machine("tritus", { queued: 3 }),
      machine("quintus"),
    ];
    const items = buildSearchIndex({ rows: [], machines }).filter((i) => i.section === "Machines");
    expect(items.map((i) => i.subtitle)).toEqual(["running a/stack", "3 jobs queued", "idle"]);
  });
});

// ---------- searchIndex ----------

const INDEX: SearchItem[] = [
  { section: "Combinations", id: "c1", title: "Swift 1.5 / 27B llamacpp", subtitle: "vidi · qwen/3.8-swift-1.5/27b", href: "#c1" },
  { section: "Runs", id: "r1", title: "v2-r3", subtitle: "Swift 1.5 · gruntus (RTX 4090)", href: "#r1" },
  { section: "Runs", id: "r2", title: "v2-r9", subtitle: "Dense 27B · gruntus (RTX 4090)", href: "#r2" },
  { section: "Stories", id: "s1", title: "Pan and zoom around an infinite board", subtitle: "vidi · story 1", href: "#s1" },
  { section: "Machines", id: "m1", title: "gruntus", subtitle: "running a/stack", href: "#m1" },
];

describe("searchIndex", () => {
  it("an empty or blank query matches nothing", () => {
    expect(searchIndex(INDEX, "")).toEqual([]);
    expect(searchIndex(INDEX, "   ")).toEqual([]);
  });

  it("every token must be found, in the title or the subtitle, case-insensitively", () => {
    const groups = searchIndex(INDEX, "gruntus");
    expect(groups.map((g) => g.section)).toEqual(["Runs", "Machines"]); // title hit (machine) and subtitle-only hits (runs)
    const runs = groups.find((g) => g.section === "Runs")!;
    expect(runs.matches.map((m) => m.item.id)).toEqual(["r1", "r2"]);
  });

  it("a query with no match anywhere returns no groups", () => {
    expect(searchIndex(INDEX, "nonexistent-xyz")).toEqual([]);
  });

  it("a multi-word query requires every word to appear somewhere in the item", () => {
    const groups = searchIndex(INDEX, "swift gruntus");
    const runs = groups.find((g) => g.section === "Runs")!;
    expect(runs.matches.map((m) => m.item.id)).toEqual(["r1"]); // r2 is "Dense 27B", not Swift
  });

  it("a title match outranks a subtitle-only match, within the same section", () => {
    const groups = searchIndex([
      { section: "Runs", id: "title-hit", title: "v2-gruntus", subtitle: "x", href: "#" },
      { section: "Runs", id: "subtitle-hit", title: "unrelated", subtitle: "on gruntus", href: "#" },
    ], "gruntus");
    expect(groups[0].matches.map((m) => m.item.id)).toEqual(["title-hit", "subtitle-hit"]);
  });

  it("groups are in information-architecture order: Combinations, Runs, Stories, Machines, skipping empty ones", () => {
    const groups = searchIndex(INDEX, "a");
    const present = groups.map((g) => g.section);
    expect(present).toEqual(["Combinations", "Runs", "Stories", "Machines"].filter((s) => present.includes(s as never)));
    for (let i = 1; i < present.length; i++) {
      const order = ["Combinations", "Runs", "Stories", "Machines"];
      expect(order.indexOf(present[i])).toBeGreaterThan(order.indexOf(present[i - 1]));
    }
  });

  it("each section is capped, and ties within a section break by title", () => {
    const big: SearchItem[] = Array.from({ length: 10 }, (_, i) => ({ section: "Machines", id: `m${i}`, title: `node-${i}`, subtitle: "", href: "#" }));
    const groups = searchIndex(big, "node", 3);
    expect(groups[0].matches).toHaveLength(3);
    expect(groups[0].matches.map((m) => m.item.title)).toEqual(["node-0", "node-1", "node-2"]);
  });

  it("marks every occurrence of every token, as character ranges, for bolding", () => {
    const groups = searchIndex([{ section: "Machines", id: "m", title: "aa-aa", subtitle: "x aa", href: "#" }], "aa");
    const m = groups[0].matches[0];
    expect(m.titleMarks).toEqual([[0, 2], [3, 5]]);
    expect(m.subtitleMarks).toEqual([[2, 4]]);
  });
});
