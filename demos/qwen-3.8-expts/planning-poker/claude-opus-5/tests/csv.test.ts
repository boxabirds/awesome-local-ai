import { describe, expect, it } from "vitest";
import { parseDelimited, parseIssues } from "../src/lib/csv";

describe("parseDelimited", () => {
  it("handles quoted fields containing commas and escaped quotes", () => {
    expect(parseDelimited('a,"b,c","say ""hi"""')).toEqual([["a", "b,c", 'say "hi"']]);
  });

  it("splits on CRLF and LF alike", () => {
    expect(parseDelimited("a,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("drops blank rows", () => {
    expect(parseDelimited("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("parseIssues", () => {
  it("treats one title per line as an untagged issue", () => {
    expect(parseIssues("Fix the importer\nRewrite the cron")).toEqual([
      { key: null, title: "Fix the importer" },
      { key: null, title: "Rewrite the cron" },
    ]);
  });

  it("pulls a leading ticket key out of a headerless list", () => {
    expect(parseIssues("PROJ-14, Rework the import job")).toEqual([
      { key: "PROJ-14", title: "Rework the import job" },
    ]);
  });

  it("uses the header row to find key and summary columns", () => {
    const input = "Key,Summary,Status\nAB-1,Add retries,Todo\nAB-2,Delete dead code,Todo";
    expect(parseIssues(input)).toEqual([
      { key: "AB-1", title: "Add retries" },
      { key: "AB-2", title: "Delete dead code" },
    ]);
  });

  it("ignores rows with no title", () => {
    expect(parseIssues("Key,Summary\nAB-1,\nAB-2,Real work")).toEqual([
      { key: "AB-2", title: "Real work" },
    ]);
  });

  it("does not mistake a lone data row for a header", () => {
    expect(parseIssues("title of my ticket")).toEqual([
      { key: null, title: "title of my ticket" },
    ]);
  });
});
