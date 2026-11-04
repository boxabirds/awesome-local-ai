import { describe, expect, it } from "vitest";
import { recordHref } from "../shared/recordLinks.ts";
import { recordResponse } from "./recordRoutes.ts";

const DIR = "combinations/stackA/benchmarks/vidi/r1";
const OTHER = "combinations/stackA/benchmarks/vidi/r10";
const docs = new Map<string, string>([
  [`${DIR}/summary.md`, "# r1 <b>\n"],
  [`${DIR}/metrics.json`, "{\"stories\":{}}"],
  [`${DIR}/rescore/vidi-v2/per-story.md`, "| story |\n"],
  [`${DIR}/rescore/vidi-v2/stories/02/accept.json`, "{\"private\":\"held-out detail\"}"],
  [`${OTHER}/summary.md`, "# r10\n"],
]);

describe("the record routes serve the result documents read from the lake", () => {
  it("a document: its text as written, markdown as plain text and JSON as JSON", () => {
    expect(recordResponse(docs, recordHref(DIR, "summary.md"))).toEqual({ contentType: "text/plain; charset=utf-8", body: "# r1 <b>\n" });
    expect(recordResponse(docs, recordHref(DIR, "metrics.json"))).toEqual({ contentType: "application/json; charset=utf-8", body: "{\"stories\":{}}" });
    expect(recordResponse(docs, recordHref(DIR, "rescore/vidi-v2/per-story.md"))?.body).toBe("| story |\n");
  });

  it("the run's record: a page listing its documents, each linked, and no other run's", () => {
    const r = recordResponse(docs, recordHref(DIR))!;
    expect(r.contentType).toBe("text/html; charset=utf-8");
    expect(r.body).toContain(`<a href="${recordHref(DIR, "summary.md")}">summary.md</a>`);
    expect(r.body).toContain(`<a href="${recordHref(DIR, "rescore/vidi-v2/per-story.md")}">rescore/vidi-v2/per-story.md</a>`);
    expect(r.body).not.toContain("r10");
  });

  it("a held-out result in full (accept.json) is never served, nor listed", () => {
    expect(recordResponse(docs, recordHref(DIR, "rescore/vidi-v2/stories/02/accept.json"))).toBeNull();
    expect(recordResponse(docs, recordHref(DIR))!.body).not.toContain("accept.json");
  });

  it("a document or run the lake does not have, or an address that does not decode: not found", () => {
    expect(recordResponse(docs, recordHref(DIR, "finalize.json"))).toBeNull();
    expect(recordResponse(docs, recordHref("combinations/none/benchmarks/vidi/r9"))).toBeNull();
    expect(recordResponse(docs, "/record/%E0%A4%A")).toBeNull();
    expect(recordResponse(docs, "/record/")).toBeNull();
  });

  it("text in a name is escaped in the listing", () => {
    const odd = new Map([[`${DIR}/a<b>.md`, "x"]]);
    expect(recordResponse(odd, recordHref(DIR))!.body).toContain("a&lt;b&gt;.md");
  });
});
