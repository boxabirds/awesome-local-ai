import { describe, expect, it } from "vitest";
import { RECORD_ROUTE, recordHref } from "./recordLinks.ts";

const DIR = "combinations/qwen/3.8/27b/ubuntu/box/gufo-pi/benchmarks/vidi/v2-r5";

describe("a run's record is the app's own address, not a repository host's", () => {
  it("the record: the run's folder under /record/, ending in a slash", () => {
    expect(recordHref(DIR)).toBe(`${RECORD_ROUTE}${DIR}/`);
    expect(recordHref(DIR).startsWith("/record/")).toBe(true);
  });
  it("one document of it: its path below the run's folder", () => {
    expect(recordHref(DIR, "summary.md")).toBe(`/record/${DIR}/summary.md`);
    expect(recordHref(DIR, "rescore/vidi-v2.0-pre1/per-story.md")).toBe(`/record/${DIR}/rescore/vidi-v2.0-pre1/per-story.md`);
  });
  it("each segment is encoded, the slashes between them are kept", () => {
    expect(recordHref("combinations/a b/benchmarks/vidi/r#1", "x?.md")).toBe("/record/combinations/a%20b/benchmarks/vidi/r%231/x%3F.md");
  });
});
