import { describe, expect, it } from "vitest";
import { combinationHref, machineHref, overviewHref, parseRoute, runHref, storyHref, storyRunHref, withParams } from "./routes.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";

// The cases, MECE by page, then by the shape of the ids, then by malformed addresses.
describe("each page's address reads back as that page", () => {
  it("overview", () => {
    expect(parseRoute(overviewHref())).toEqual({ page: "overview", params: {} });
  });
  it("combination, whose id holds slashes", () => {
    expect(parseRoute(combinationHref("vidi", SWIFT))).toEqual({ page: "combination", pack: "vidi", stack: SWIFT, params: {} });
  });
  it("run", () => {
    expect(parseRoute(runHref("vidi", SWIFT, "v2-r2"))).toEqual({ page: "run", pack: "vidi", stack: SWIFT, runId: "v2-r2", params: {} });
  });
  it("story run", () => {
    expect(parseRoute(storyRunHref("vidi", OPUS, "v2-r1", "12"))).toEqual({ page: "storyRun", pack: "vidi", stack: OPUS, runId: "v2-r1", story: "12", params: {} });
  });
});

describe("the pack keeps runs of the same id apart", () => {
  it("run-1 of Opus in two packs is two addresses", () => {
    expect(runHref("vidi", OPUS, "run-1")).not.toBe(runHref("todoodle", OPUS, "run-1"));
    expect(parseRoute(runHref("todoodle", OPUS, "run-1"))).toEqual({ page: "run", pack: "todoodle", stack: OPUS, runId: "run-1", params: {} });
  });
});

describe("ids of every shape survive the round trip", () => {
  it.each([
    ["a run id with dots and underscores", SWIFT, "canvas-pi_01.b"],
    ["a run id with a space and a hash", SWIFT, "run #2 x"],
    ["a combination with a percent sign", "qwen/50%/x", "r1"],
  ])("%s", (_, stack, runId) => {
    expect(parseRoute(runHref("vidi", stack, runId))).toEqual({ page: "run", pack: "vidi", stack, runId, params: {} });
  });
  it("a story written with a leading zero is the same story", () => {
    expect(storyRunHref("vidi", SWIFT, "v2-r1", "02")).toBe(storyRunHref("vidi", SWIFT, "v2-r1", "2"));
    expect(parseRoute(`${runHref("vidi", SWIFT, "v2-r1")}/s/02`)).toMatchObject({ story: "2" });
  });
});

describe("addresses are forgiving about slashes and the hash itself", () => {
  it.each(["", "#", "#/", "/", "#//"])("%j is the overview", (h) => {
    expect(parseRoute(h)).toEqual({ page: "overview", params: {} });
  });
  it("a trailing slash is the same page", () => {
    expect(parseRoute(`${runHref("vidi", SWIFT, "v2-r1")}/`)).toEqual({ page: "run", pack: "vidi", stack: SWIFT, runId: "v2-r1", params: {} });
  });
});

describe("anything else is not found, never a guess", () => {
  it.each([
    ["an unknown kind", "#/vidi/x/abc"],
    ["a pack alone", "#/vidi"],
    ["no pack", `#/c/${encodeURIComponent(SWIFT)}`],
    ["a combination with no id", "#/vidi/c"],
    ["a run with no run id", `#/vidi/r/${encodeURIComponent(SWIFT)}`],
    ["a combination id split into segments (not encoded)", "#/vidi/c/qwen/3.8"],
    ["a story that isn't a number", `${runHref("vidi", SWIFT, "v2-r1")}/s/two`],
    ["a story run with extra segments", `${storyRunHref("vidi", SWIFT, "v2-r1", "2")}/more`],
    ["an empty segment", "#/vidi/r//v2-r1"],
    ["broken percent-encoding", "#/vidi/c/%E0%A4%A"],
  ])("%s", (_, h) => {
    expect(parseRoute(h).page).toBe("notFound");
  });
});

describe("story and machine pages", () => {
  it("a story page is per pack", () => {
    expect(parseRoute(storyHref("vidi", "7"))).toEqual({ page: "story", pack: "vidi", story: "7", params: {} });
    expect(storyHref("vidi", "07")).toBe(storyHref("vidi", "7"));
  });
  it("a machine page isn't: a machine runs every pack", () => {
    expect(parseRoute(machineHref("node-a"))).toEqual({ page: "machine", machine: "node-a", params: {} });
    expect(parseRoute(machineHref("node-b.local"))).toMatchObject({ machine: "node-b.local" });
  });
  it.each([
    ["a story that isn't a number", "#/vidi/s/two"],
    ["a machine with no name", "#/m"],
    ["a machine with extra segments", "#/m/node-a/x"],
  ])("%s is not found", (_, h) => expect(parseRoute(h).page).toBe("notFound"));
});

describe("page state rides along as query parameters", () => {
  it("any page keeps its parameters, decoded", () => {
    expect(parseRoute(withParams(combinationHref("vidi", SWIFT), { metric: "calls" }))).toEqual(
      { page: "combination", pack: "vidi", stack: SWIFT, params: { metric: "calls" } });
    expect(parseRoute(withParams(runHref("vidi", SWIFT, "v2-r5"), { compare: "v2 r4&x" })).params).toEqual({ compare: "v2 r4&x" });
  });
  it("empty values are left out, and no parameters means a plain address", () => {
    expect(withParams(machineHref("node-a"), { a: "", b: undefined })).toBe(machineHref("node-a"));
  });
  it("the overview keeps its parameters too", () => {
    expect(parseRoute(withParams(overviewHref(), { tab: "machines" }))).toEqual({ page: "overview", params: { tab: "machines" } });
  });
});

describe("conversation addresses", () => {
  it("a story run's conversation and one of its calls round-trip, with the section asked for", async () => {
    const { conversationHref, callHref, parseRoute } = await import("./routes.ts");
    const stack = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
    const href = conversationHref("vidi", stack, "v2-r1", "3", "tool");
    expect(href).toBe(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation?kind=tool`);
    expect(parseRoute(href)).toEqual({ page: "conversation", pack: "vidi", stack, runId: "v2-r1", story: "3", params: { kind: "tool" } });
    const call = callHref("vidi", stack, "v2-r1", "03", 7);
    expect(call).toBe(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation/c/7`);
    expect(parseRoute(call)).toEqual({ page: "call", pack: "vidi", stack, runId: "v2-r1", story: "3", call: "7", params: {} });
    expect(parseRoute(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation/c/x`).page).toBe("notFound");
    expect(parseRoute(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/other`).page).toBe("notFound");
  });
});

// Navigation (specs/general/UI-IMPROVEMENTS.md, Part 1): every screen has an address, each page knows its section,
// and one function spells every page's trail.
describe("section addresses", () => {
  it("the four sections: #/ is runs, and machines, setup and a pack's stories have addresses of their own", async () => {
    const { machinesHref, setupHref, storiesHref, parseRoute } = await import("./routes.ts");
    expect(parseRoute(machinesHref())).toEqual({ page: "machines", params: {} });
    expect(parseRoute(setupHref())).toEqual({ page: "setup", params: {} });
    expect(parseRoute(storiesHref("vidi"))).toEqual({ page: "stories", pack: "vidi", params: {} });
    expect(machinesHref()).toBe("#/machines");
    expect(setupHref()).toBe("#/setup");
    expect(storiesHref("vidi")).toBe("#/vidi/stories");
  });
  it("a machine page sits under machines, and the old #/m/ address still opens it", () => {
    expect(machineHref("node-a")).toBe("#/machines/node-a");
    expect(parseRoute("#/machines/node-a")).toEqual({ page: "machine", machine: "node-a", params: {} });
    expect(parseRoute("#/m/node-a")).toEqual({ page: "machine", machine: "node-a", params: {} });
  });
  it.each([
    ["machines with extra segments", "#/machines/node-a/x"],
    ["setup with a segment", "#/setup/x"],
    ["stories with a segment", "#/vidi/stories/2"],
  ])("%s is not found", (_, h) => expect(parseRoute(h).page).toBe("notFound"));
  it("every page kind belongs to one section; not found to none", async () => {
    const { sectionOf, conversationHref, callHref, machinesHref, setupHref, storiesHref } = await import("./routes.ts");
    const of = (h: string) => sectionOf(parseRoute(h));
    expect(of(overviewHref())).toBe("runs");
    expect(of(combinationHref("vidi", SWIFT))).toBe("runs");
    expect(of(runHref("vidi", SWIFT, "v2-r1"))).toBe("runs");
    expect(of(storyRunHref("vidi", SWIFT, "v2-r1", "2"))).toBe("runs");
    expect(of(conversationHref("vidi", SWIFT, "v2-r1", "2"))).toBe("runs");
    expect(of(callHref("vidi", SWIFT, "v2-r1", "2", 0))).toBe("runs");
    expect(of(storiesHref("vidi"))).toBe("stories");
    expect(of(storyHref("vidi", "2"))).toBe("stories");
    expect(of(machinesHref())).toBe("machines");
    expect(of(machineHref("node-a"))).toBe("machines");
    expect(of(setupHref())).toBe("setup");
    expect(of("#/vidi/x")).toBe(null);
  });
});

describe("the trail, one shape per page kind", () => {
  const names = { combination: "3.8-swift-1.5/27b llamacpp" };
  const texts = (crumbs: { label: string; href?: string }[]) => crumbs.map((c) => (c.href ? `${c.label}(${c.href})` : c.label));
  it.each([
    ["overview", overviewHref(), []],
    ["combination", combinationHref("vidi", SWIFT), ["Overview(#/)", "3.8-swift-1.5/27b llamacpp"]],
    ["run", runHref("vidi", SWIFT, "v2-r1"), ["Overview(#/)", `3.8-swift-1.5/27b llamacpp(${combinationHref("vidi", SWIFT)})`, "v2-r1"]],
    ["story run", storyRunHref("vidi", SWIFT, "v2-r1", "02"), ["Overview(#/)", `3.8-swift-1.5/27b llamacpp(${combinationHref("vidi", SWIFT)})`, `v2-r1(${runHref("vidi", SWIFT, "v2-r1")})`, "Story 2"]],
    ["conversation", `${storyRunHref("vidi", SWIFT, "v2-r1", "2")}/conversation?kind=tool`, ["Overview(#/)", `3.8-swift-1.5/27b llamacpp(${combinationHref("vidi", SWIFT)})`, `v2-r1(${runHref("vidi", SWIFT, "v2-r1")})`, `Story 2(${storyRunHref("vidi", SWIFT, "v2-r1", "2")})`, "Conversation"]],
    ["call", `${storyRunHref("vidi", SWIFT, "v2-r1", "2")}/conversation/c/3`, ["Overview(#/)", `3.8-swift-1.5/27b llamacpp(${combinationHref("vidi", SWIFT)})`, `v2-r1(${runHref("vidi", SWIFT, "v2-r1")})`, `Story 2(${storyRunHref("vidi", SWIFT, "v2-r1", "2")})`, `Conversation(${storyRunHref("vidi", SWIFT, "v2-r1", "2")}/conversation)`, "Call 4"]],
    ["stories", "#/vidi/stories", ["Overview(#/)", "Stories"]],
    ["story", storyHref("vidi", "7"), ["Overview(#/)", "Stories(#/vidi/stories)", "Story 7"]],
    ["machines", "#/machines", ["Overview(#/)", "Machines"]],
    ["machine", machineHref("node-a"), ["Overview(#/)", "Machines(#/machines)", "node-a"]],
    ["setup", "#/setup", ["Overview(#/)", "Setup"]],
    ["not found", "#/vidi/x", []],
  ])("%s", async (_, href, want) => {
    const { trailFor } = await import("./routes.ts");
    expect(texts(trailFor(parseRoute(href), names))).toEqual(want);
  });
  it("the combination crumb carries the full id as its hover, and each entity crumb its link class", async () => {
    const { trailFor } = await import("./routes.ts");
    const trail = trailFor(parseRoute(storyRunHref("vidi", SWIFT, "v2-r1", "2")), names);
    expect(trail[1]).toMatchObject({ cls: "combination-link", tip: SWIFT });
    expect(trail[2]).toMatchObject({ cls: "run-link", tip: `${SWIFT} · v2-r1` });
    expect(trail[3]).not.toHaveProperty("href");
  });
  it("a page's title is its trail, nearest first", async () => {
    const { titleFor, trailFor } = await import("./routes.ts");
    expect(titleFor(trailFor(parseRoute(runHref("vidi", SWIFT, "v2-r1")), names))).toBe("v2-r1 · 3.8-swift-1.5/27b llamacpp · Benchmarker");
    expect(titleFor(trailFor(parseRoute(overviewHref()), names))).toBe("Benchmarker");
    expect(titleFor(trailFor(parseRoute(machineHref("node-a")), names))).toBe("node-a · Machines · Benchmarker");
  });
});
