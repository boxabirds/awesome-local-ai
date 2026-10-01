import { useState } from "react";
import type { Row } from "../../shared/types.ts";
import { closeCalls, compareRanked, INDISTINGUISHABLE_TESTS, NOT_COUNTED_ORDER, rankCombinations, SMALL_N, type RankedCombination, type Spread } from "../../shared/stats.ts";
import type { TermId } from "../../shared/glossary.ts";
import { qualityClass } from "../format.ts";
import { CombinationLink } from "./EntityLinks.tsx";
import { termName, termTip } from "./combination/Term.tsx";
import { fmtCount, fmtHours, fmtTokens, SpreadText } from "./combination/Spread.tsx";
import { predictability, type Predictability } from "../../shared/predictability.ts";
import { fmtMinutes, fmtThinking, SpreadFigure } from "./combination/Predictability.tsx";

const PERCENT = 100;
const SPEED_DECIMALS = 0;
const RANK = "score";

/** Each column: its glossary term, class, and the number it sorts by (null: last, whichever way). */
const COLUMNS: { term: TermId; cls: string; value: (c: RankedCombination, p: Predictability) => number | string | null }[] = [
  { term: "combination", cls: "combo", value: (c) => c.label },
  { term: "comboMachines", cls: "machines", value: (c) => c.machines.join(", ") },
  { term: "scoreSummary", cls: RANK, value: (c) => c.score?.median ?? null },
  { term: "pooledPassRate", cls: "pooled", value: (c) => c.score?.pooled ?? null },
  { term: "hoursPerStory", cls: "hours", value: (c) => c.hoursPerStory?.median ?? null },
  { term: "outPerStory", cls: "out", value: (c) => c.outPerStory?.median ?? null },
  { term: "callsPerStory", cls: "calls", value: (c) => c.callsPerStory?.median ?? null },
  { term: "thinkingSpread", cls: "think-spread", value: (_c, p) => p.thinkingSpread },
  { term: "timeSpread", cls: "time-spread", value: (_c, p) => p.timeSpread },
  { term: "tokSOfRecord", cls: "toks", value: (c) => c.tokS?.median ?? null },
  { term: "inputPerStory", cls: "read", value: (c) => c.readPerStory?.median ?? null },
  { term: "notCounted", cls: "not-counted", value: (c) => Object.values(c.notCounted).reduce((a, b) => a + (b ?? 0), 0) },
];

const NONE = "no finished run of record";

function spreadCell(s: Spread | null, fmt: (n: number) => string) {
  return s ? <SpreadText s={s} fmt={fmt} /> : <span className="missing" data-tip={`No ${NONE} recorded this.`}>—</span>;
}

/** A spread with its amount under it: the spread alone says nothing about how much is thought or how long it takes. */
function spreadWithAmount(p: Predictability, spread: number | null, amount: string | null) {
  return <><SpreadFigure p={p} spread={spread} />{amount === null ? null : <span className="amount small">{amount}</span>}</>;
}

function cell(c: RankedCombination, cls: string, p: Predictability) {
  switch (cls) {
    case "combo": return <span className="stack-label"><CombinationLink pack={c.pack} stack={c.stack} label={c.label} /></span>;
    case "machines": return c.machines.join(", ");
    case RANK: return c.score
      ? <span data-tip={`Score of record: the median of ${c.score.n} finished run${c.score.n === 1 ? "" : "s"} re-scored under the current suite, lowest–highest in brackets.`}>
          <SpreadText s={c.score} fmt={fmtCount} big={`num-xl ${qualityClass(c.score.total ? c.score.median / c.score.total : null)}`} showN />
        </span>
      : <span className="unranked" data-tip={termTip("unranked")}>not ranked: {c.unranked}</span>;
    case "pooled": return c.score ? <span className="num">{Math.round(c.score.pooled * PERCENT)}%</span> : <span className="missing" data-tip={`No ${NONE}.`}>—</span>;
    case "hours": return spreadCell(c.hoursPerStory, fmtHours);
    case "out": return spreadCell(c.outPerStory, fmtTokens);
    case "calls": return spreadCell(c.callsPerStory, fmtCount);
    case "think-spread": return spreadWithAmount(p, p.thinkingSpread, fmtThinking(p));
    case "time-spread": return spreadWithAmount(p, p.timeSpread, p.minutesPerStory === null ? null : `${fmtMinutes(p.minutesPerStory)} min`);
    case "toks": return spreadCell(c.tokS, (n) => n.toFixed(SPEED_DECIMALS));
    case "read": return spreadCell(c.readPerStory, fmtTokens);
    case "not-counted": {
      const parts = NOT_COUNTED_ORDER.filter((s) => c.notCounted[s]).map((s) => ({ s, text: `${c.notCounted[s]} ${s}` }));
      return parts.length ? <span className="small not-counted-list">{parts.map((p) => <span key={p.s} data-standing={p.s}>{p.text}</span>)}</span> : <span className="small">none</span>;
    }
  }
  return null;
}

/** The note small n needs: which neighbours can't be told apart, or that none are close. */
function SmallN({ ranked }: { ranked: RankedCombination[] }) {
  const few = ranked.some((c) => c.score && c.score.n <= SMALL_N);
  if (!few) return null;
  const close = closeCalls(ranked);
  return (
    <p className="small-n-note" data-tip={termTip("smallN")}>
      <b>{termName("smallN")}:</b> With {SMALL_N} runs or fewer, a difference of {INDISTINGUISHABLE_TESTS} tests or less can't separate two combinations.
      {close.length ? <> Not distinguishable here: {close.map(([a, b], i) => (
        <span key={`${a.stack}~${b.stack}`}>{i ? "; " : " "}<CombinationLink pack={a.pack} stack={a.stack} label={a.label} /> ({a.score!.median}, n={a.score!.n}) and <CombinationLink pack={b.pack} stack={b.stack} label={b.label} /> ({b.score!.median}, n={b.score!.n})</span>
      ))}.</> : " No two neighbours here are that close."}
    </p>
  );
}

/** One row per combination over the runs the filters show, ranked on finished runs' scores of record; sortable. */
export function CombinationsTable({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ cls: string; dir: 1 | -1 }>({ cls: RANK, dir: -1 });
  const col = COLUMNS.find((c) => c.cls === sort.cls)!;
  const ranked = rankCombinations(rows);
  const spreads = new Map(ranked.map((c) => [c.stack, predictability(rows.filter((r) => r.stack === c.stack))]));
  const pred = (c: RankedCombination) => spreads.get(c.stack)!;
  const list = sort.cls === RANK && sort.dir === -1 ? ranked : ranked.toSorted((a, b) => {
    const x = col.value(a, pred(a)), y = col.value(b, pred(b));
    if (x === null || y === null) return x === y ? compareRanked(a, b) : x === null ? 1 : -1;  // no number: last either way
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir || compareRanked(a, b);
  });
  if (list.length === 0) return null;
  const counted = ranked.reduce((n, c) => n + c.ofRecord.length, 0);
  const suite = rows[0]?.suite ?? "";
  const click = (cls: string) => setSort(sort.cls === cls ? { cls, dir: sort.dir === 1 ? -1 : 1 } : { cls, dir: cls === "combo" || cls === "machines" ? 1 : -1 });
  return (
    <section className="combinations">
      <h2>
        <span>Combinations</span>
        <span className="small">ranked on finished runs' scores of record under {suite}: {counted} of the {rows.length} run{rows.length === 1 ? "" : "s"} shown (the filters above decide which)</span>
      </h2>
      <table aria-label="Combinations" className="combos">
        <thead>
          <tr>{COLUMNS.map((c) => (
            <th key={c.cls} className={c.cls} data-tip={termTip(c.term)} aria-sort={sort.cls === c.cls ? (sort.dir === 1 ? "ascending" : "descending") : "none"} onClick={() => click(c.cls)}>
              {termName(c.term)}{sort.cls === c.cls ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
            </th>))}</tr>
        </thead>
        <tbody>
          {list.map((c) => <tr key={c.stack} data-stack={c.stack} data-ranked={c.score ? "true" : "false"}>{COLUMNS.map((k) => <td key={k.cls} className={k.cls}>{cell(c, k.cls, pred(c))}</td>)}</tr>)}
        </tbody>
      </table>
      <SmallN ranked={ranked} />
    </section>
  );
}
