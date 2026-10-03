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
    const href = conversationHref("vidi", stack, "v2-r1", "3", "tools");
    expect(href).toBe(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation?at=tools`);
    expect(parseRoute(href)).toEqual({ page: "conversation", pack: "vidi", stack, runId: "v2-r1", story: "3", params: { at: "tools" } });
    const call = callHref("vidi", stack, "v2-r1", "03", 7);
    expect(call).toBe(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation/c/7`);
    expect(parseRoute(call)).toEqual({ page: "call", pack: "vidi", stack, runId: "v2-r1", story: "3", call: "7", params: {} });
    expect(parseRoute(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/conversation/c/x`).page).toBe("notFound");
    expect(parseRoute(`#/vidi/r/${encodeURIComponent(stack)}/v2-r1/s/3/other`).page).toBe("notFound");
  });
});
