// LinksCell: the ways out from a run to its record, served by the app from the lake, rendered to HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Row } from "../../shared/types.ts";
import { LinksCell } from "./LinksCell.tsx";

const DIR = "combinations/qwen/x/pi/benchmarks/vidi/v2-r1";

const run = (over: Partial<Row> = {}) => ({ dir: DIR, state: "finished", ...over }) as Row;
const html = (row: Row) => renderToStaticMarkup(<LinksCell row={row} />);

describe("LinksCell", () => {
  it("a run with no record directory has nothing to link to: a dash", () => {
    expect(html(run({ dir: null }))).toBe('<span class="wait">—</span>');
  });
  it.each(["finished", "stopped"])("a %s run links its record and its summary, both the app's own addresses", (state) => {
    const out = html(run({ state }));
    expect(out).toContain(`<a href="/record/${DIR}/" target="_blank" rel="noopener">record</a>`);
    expect(out).toContain(`<a href="/record/${DIR}/summary.md" target="_blank" rel="noopener">summary</a>`);
    expect(out).not.toContain("github");
    expect(out.startsWith('<span class="links">')).toBe(true);
  });
  it.each(["running", "queued"])("a %s run links its record only: no summary exists yet", (state) => {
    const out = html(run({ state }));
    expect(out).toContain(`href="/record/${DIR}/"`);
    expect(out).not.toContain("summary");
  });
});
