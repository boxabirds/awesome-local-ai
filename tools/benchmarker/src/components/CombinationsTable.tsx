import { useState } from "react";
import type { Row } from "../../shared/types.ts";
import { combinations, type Combination } from "../../shared/stats.ts";
import { short } from "./UsageCells.tsx";
import { qualityClass } from "../format.ts";

const PERCENT = 100;
const HOUR_DECIMALS = 1;
const SPEED_DECIMALS = 0;
const STATUS_ORDER = ["running", "queued", "finished", "failed", "stopped", "cancelled", "unknown"];

/** Each column: heading, class, hover, and the number it sorts by (null sorts last). */
const COLUMNS: { head: string; cls: string; title: string; value: (c: Combination) => number | string | null }[] = [
  { head: "Combination", cls: "combo", title: "The model, engine and client, as its folder under combinations/ names it (reference stacks under benchmarks/reference/).", value: (c) => c.label },
  { head: "Machines", cls: "machines", title: "The machines its runs ran on.", value: (c) => c.machines.join(", ") },
  { head: "Runs", cls: "runs", title: "Its runs among those the filters show, by status. Every number in the row is over these runs.", value: (c) => c.stats.runs },
  { head: "Held-out quality", cls: "quality", title: "Held-out tests passing over all held-out tests, across every built story of every run shown, each on its run's latest build. 100% = everything built passes the hidden tests. The quality measure to rank by.", value: (c) => c.stats.quality },
  { head: "Score / 75", cls: "score", title: "The mean score of record (the final build's held-out tests passing, under the current suite) over the runs that have one; n says how many.", value: (c) => c.score?.mean ?? null },
  { head: "Hours per story", cls: "hours", title: "Agent hours per recorded story, over every story of the runs shown: how long the combination takes to deliver a story.", value: (c) => c.stats.hoursPerStory },
  { head: "tok/s", cls: "toks", title: "Output tokens over the time the stories took (model, tools and all), over every recorded story.", value: (c) => c.tokS },
  { head: "Calls per story", cls: "calls", title: "Tool calls per recorded story: how many steps the agent takes. A cost measure, not a quality one.", value: (c) => c.callsPerStory },
  { head: "Input tokens per story", cls: "read", title: "Input tokens: everything the model had to read to answer, summed over all its calls. On every call it re-reads the whole conversation so far (spec, code, tool output), mostly from its cache, so this grows with the number of calls. The bigger this is, the more work each story costs.", value: (c) => c.readPerStory },
];

function cell(c: Combination, cls: string) {
  switch (cls) {
    case "combo": return <span className="stack-label" data-tip={c.stack}>{c.label}</span>;
    case "machines": return c.machines.join(", ");
    case "runs": return STATUS_ORDER.filter((s) => c.byStatus[s]).map((s) => `${c.byStatus[s]} ${s}`).join(" · ");
    case "quality": return c.stats.quality === null ? "—" : <span className={`num-xl ${qualityClass(c.stats.quality)}`}>{Math.round(c.stats.quality * PERCENT)}%</span>;
    case "score": return c.score ? <span data-tip={`${c.score.n} run${c.score.n === 1 ? "" : "s"} with a score of record`}><span className={`num-xl ${qualityClass(c.score.total ? c.score.mean / c.score.total : null)}`}>{c.score.mean.toFixed(1)}</span> <span className="small">n={c.score.n}</span></span> : "—";
    case "hours": return c.stats.hoursPerStory === null ? "—" : <span className="num-l">{c.stats.hoursPerStory.toFixed(HOUR_DECIMALS)}</span>;
    case "toks": return c.tokS === null ? "—" : <span className="num">{c.tokS.toFixed(SPEED_DECIMALS)}</span>;
    case "calls": return c.callsPerStory === null ? "—" : <span className="small">{Math.round(c.callsPerStory)}</span>;
    case "read": return c.readPerStory === null ? "—" : <span className="small">{short(Math.round(c.readPerStory))}</span>;
  }
  return null;
}

/** One row per combination, over the runs the filters show, on whatever machines they ran; sortable. */
export function CombinationsTable({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ cls: string; dir: 1 | -1 }>({ cls: "quality", dir: -1 });
  const col = COLUMNS.find((c) => c.cls === sort.cls)!;
  const list = combinations(rows).toSorted((a, b) => {
    const x = col.value(a), y = col.value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;  // no number: last either way
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
  });
  if (list.length === 0) return null;
  const click = (cls: string) => setSort(sort.cls === cls ? { cls, dir: sort.dir === 1 ? -1 : 1 } : { cls, dir: cls === "combo" || cls === "machines" ? 1 : -1 });
  return (
    <section className="combinations">
      <h2><span>Combinations</span><span className="small">over the {rows.length} run{rows.length === 1 ? "" : "s"} shown (the filters above decide which)</span></h2>
      <table aria-label="Combinations" className="combos">
        <thead>
          <tr>{COLUMNS.map((c) => (
            <th key={c.cls} data-tip={c.title} aria-sort={sort.cls === c.cls ? (sort.dir === 1 ? "ascending" : "descending") : "none"} onClick={() => click(c.cls)}>
              {c.head}{sort.cls === c.cls ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
            </th>))}</tr>
        </thead>
        <tbody>
          {list.map((c) => <tr key={c.stack} data-stack={c.stack}>{COLUMNS.map((k) => <td key={k.cls} className={k.cls}>{cell(c, k.cls)}</td>)}</tr>)}
        </tbody>
      </table>
    </section>
  );
}
