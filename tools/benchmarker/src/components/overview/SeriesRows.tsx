// Series: one row per series of runs of a stack (an n=5 experiment): its runs as segments, with the score in each
// finished one, the median score and agent time, and how many are done. A series with work in hand first; the score
// and agent time columns sort the rows (a second click reverses; a series with no figure is always last).
import { useState } from "react";
import { sortSeries, type Series, type SeriesSortDir, type SeriesSortKey } from "../../../shared/dashboardView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration } from "../../format.ts";
import { CombinationLink } from "../EntityLinks.tsx";
import { MachineLink } from "../EntityLinks.tsx";
import { SeriesBar, scoreStyle } from "./SeriesBar.tsx";

/** The direction a column sorts in the first time it is chosen: the best score first, the shortest time first. */
const FIRST_DIRECTION: Record<SeriesSortKey, SeriesSortDir> = { score: "desc", agentTime: "asc" };
const ARROW: Record<SeriesSortDir, string> = { asc: "▲", desc: "▼" };
const ARIA: Record<SeriesSortDir, "ascending" | "descending"> = { asc: "ascending", desc: "descending" };

function SortHead({ id, label, tip, sort, onSort }: { id: SeriesSortKey; label: string; tip: string; sort: { key: SeriesSortKey; dir: SeriesSortDir } | null; onSort: (k: SeriesSortKey) => void }) {
  const on = sort?.key === id ? sort.dir : null;
  return (
    <span role="columnheader" aria-sort={on ? ARIA[on] : "none"} className="series-sort">
      <button type="button" data-sort={id} aria-sort={on ? ARIA[on] : "none"} data-tip={tip} onClick={() => onSort(id)}>{label}{on ? <span aria-hidden="true"> {ARROW[on]}</span> : null}</button>
    </span>
  );
}

export function SeriesRows({ series, pack }: { series: Series[]; pack: string }) {
  const [sort, setSort] = useState<{ key: SeriesSortKey; dir: SeriesSortDir } | null>(null);
  if (series.length === 0) return null;
  const onSort = (key: SeriesSortKey) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIRECTION[key] }));
  const shown = sort ? sortSeries(series, sort.key, sort.dir) : series;
  return (
    <section className="ov-section series" data-section="series" aria-labelledby="h-series">
      <h2 id="h-series">Series <span className="small">runs, score (median), agent time (median), finished</span></h2>
      <ul className="series-list">
        <li className="series-head small" role="row" aria-label="Series columns">
          <span className="series-head-name">Series</span><span />
          <SortHead id="score" label={GLOSSARY.scoreOfRecord.name} tip="Sort by the median score of record" sort={sort} onSort={onSort} />
          <SortHead id="agentTime" label={GLOSSARY.agentTime.name} tip="Sort by the median agent time of the finished runs" sort={sort} onSort={onSort} />
          <span />
        </li>
        {shown.map((s) => (
          <li key={`${s.stack}|${s.prefix}`} className="series-row" data-stack={s.stack} data-prefix={s.prefix} data-active={s.active ? "true" : "false"}
              data-score={s.score ? s.score.median : ""} data-seconds={s.agentTime ? s.agentTime.median : ""}>
            <span className="series-name"><CombinationLink pack={pack} stack={s.stack} label={s.label} /> <span className="small">{s.prefix} on <MachineLink machine={s.machine} /></span></span>
            <SeriesBar series={s} pack={pack} />
            <span className="series-score" data-tip={s.score ? `Median of ${s.score.n} scored run${s.score.n === 1 ? "" : "s"}, ${s.score.min} to ${s.score.max}` : "No run scored yet."}
                  style={s.score && s.score.total ? scoreStyle(s.score.median, s.score.total) : undefined}>
              {s.score ? <>{Number.isInteger(s.score.median) ? s.score.median : s.score.median.toFixed(1)}{s.score.total ? `/${s.score.total}` : ""}</> : "—"}
            </span>
            <span className="series-time" data-tip={s.agentTime ? `Median of ${s.agentTime.n} finished run${s.agentTime.n === 1 ? "" : "s"}, ${duration(s.agentTime.min)} to ${duration(s.agentTime.max)}` : "No finished run has a time yet."}>
              {s.agentTime ? duration(s.agentTime.median) : "—"}
            </span>
            <span className="small series-count" data-tip={`${s.done} of ${s.size} runs finished`}>{s.done}/{s.size}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
