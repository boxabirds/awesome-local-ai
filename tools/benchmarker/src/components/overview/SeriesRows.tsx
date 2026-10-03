// Series: one row per series of runs of a stack (an n=5 experiment): its runs as segments, with the score in each
// finished one, and how many are done. A series with work in hand first.
import type { Series } from "../../../shared/dashboardView.ts";
import { CombinationLink } from "../EntityLinks.tsx";
import { MachineLink } from "../EntityLinks.tsx";
import { SeriesBar, scoreStyle } from "./SeriesBar.tsx";

export function SeriesRows({ series, pack }: { series: Series[]; pack: string }) {
  if (series.length === 0) return null;
  return (
    <section className="ov-section series" data-section="series" aria-labelledby="h-series">
      <h2 id="h-series">Series <span className="small">runs, score (median), finished</span></h2>
      <ul className="series-list">
        {series.map((s) => (
          <li key={`${s.stack}|${s.prefix}`} className="series-row" data-stack={s.stack} data-prefix={s.prefix} data-active={s.active ? "true" : "false"}>
            <span className="series-name"><CombinationLink pack={pack} stack={s.stack} label={s.label} /> <span className="small">{s.prefix} on <MachineLink machine={s.machine} /></span></span>
            <SeriesBar series={s} pack={pack} />
            <span className="series-score" data-tip={s.score ? `Median of ${s.score.n} scored run${s.score.n === 1 ? "" : "s"}, ${s.score.min} to ${s.score.max}` : "No run scored yet."}
                  style={s.score && s.score.total ? scoreStyle(s.score.median, s.score.total) : undefined}>
              {s.score ? <>{Number.isInteger(s.score.median) ? s.score.median : s.score.median.toFixed(1)}{s.score.total ? `/${s.score.total}` : ""}</> : "—"}
            </span>
            <span className="small series-count" data-tip={`${s.done} of ${s.size} runs finished`}>{s.done}/{s.size}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
