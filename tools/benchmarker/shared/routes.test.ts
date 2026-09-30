import { describe, expect, it } from "vitest";
import { combinationHref, overviewHref, parseRoute, runHref, storyRunHref } from "./routes.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";

// The cases, MECE by page, then by the shape of the ids, then by malformed addresses.
describe("each page's address reads back as that page", () => {
  it("overview", () => {
    expect(parseRoute(overviewHref())).toEqual({ page: "overview" });
  });
  it("combination, whose id holds slashes", () => {
    expect(parseRoute(combinationHref("vidi", SWIFT))).toEqual({ page: "combination", pack: "vidi", stack: SWIFT });
  });
  it("run", () => {
    expect(parseRoute(runHref("vidi", SWIFT, "v2-r2"))).toEqual({ page: "run", pack: "vidi", stack: SWIFT, runId: "v2-r2" });
  });
  it("story run", () => {
    expect(parseRoute(storyRunHref("vidi", OPUS, "v2-r1", "12"))).toEqual({ page: "storyRun", pack: "vidi", stack: OPUS, runId: "v2-r1", story: "12" });
  });
});

describe("the pack keeps runs of the same id apart", () => {
  it("run-1 of Opus in two packs is two addresses", () => {
    expect(runHref("vidi", OPUS, "run-1")).not.toBe(runHref("todoodle", OPUS, "run-1"));
    expect(parseRoute(runHref("todoodle", OPUS, "run-1"))).toEqual({ page: "run", pack: "todoodle", stack: OPUS, runId: "run-1" });
  });
});

describe("ids of every shape survive the round trip", () => {
  it.each([
    ["a run id with dots and underscores", SWIFT, "canvas-pi_01.b"],
    ["a run id with a space and a hash", SWIFT, "run #2 x"],
    ["a combination with a percent sign", "qwen/50%/x", "r1"],
  ])("%s", (_, stack, runId) => {
    expect(parseRoute(runHref("vidi", stack, runId))).toEqual({ page: "run", pack: "vidi", stack, runId });
  });
  it("a story written with a leading zero is the same story", () => {
    expect(storyRunHref("vidi", SWIFT, "v2-r1", "02")).toBe(storyRunHref("vidi", SWIFT, "v2-r1", "2"));
    expect(parseRoute(`${runHref("vidi", SWIFT, "v2-r1")}/s/02`)).toMatchObject({ story: "2" });
  });
});

describe("addresses are forgiving about slashes and the hash itself", () => {
  it.each(["", "#", "#/", "/", "#//"])("%j is the overview", (h) => {
    expect(parseRoute(h)).toEqual({ page: "overview" });
  });
  it("a trailing slash is the same page", () => {
    expect(parseRoute(`${runHref("vidi", SWIFT, "v2-r1")}/`)).toEqual({ page: "run", pack: "vidi", stack: SWIFT, runId: "v2-r1" });
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
