import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GLOSSARY } from "./glossary.ts";

// The glossary is one object literal of about a hundred terms. A key written twice is not an error at run time: the
// later one silently wins, and a page then explains itself with another term's words (that happened on 3 October 2026,
// when a new "activity" term was overridden by the live-progress one, and the page showed the wrong sentence). `tsc`
// would catch it, but it is blocked in this project, so the source is read here.
describe("the glossary", () => {
  const src = readFileSync(new URL("./glossary.ts", import.meta.url), "utf8");
  const keys = [...src.slice(src.indexOf("GLOSSARY")).matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*\{/gm)].map((m) => m[1]);

  it("defines every term exactly once", () => {
    const seen = new Set<string>();
    expect(keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)))).toEqual([]);
  });

  it("reads every term the file declares, so the check above covers the whole object", () => {
    expect(keys.length).toBeGreaterThan(50);
    expect(new Set(keys)).toEqual(new Set(Object.keys(GLOSSARY)));
  });

  it("every term has a name and an explanation (a legend's label is allowed to be two words)", () => {
    for (const [id, t] of Object.entries(GLOSSARY)) {
      expect(t.name.trim(), id).toBeTruthy();
      expect(t.what.trim(), id).toBeTruthy();
    }
  });
});
