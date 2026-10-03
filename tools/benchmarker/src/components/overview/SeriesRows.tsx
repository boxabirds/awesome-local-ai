// Series: one row per series of runs of a stack (an n=5 experiment): its runs as segments, with the score in each
// finished one, and how many are done. A series with work in hand first.
import type { Series } from "../../../shared/dashboardView.ts";
import { CombinationLink } from "../EntityLinks.tsx";
import { MachineLink } from "../EntityLinks.tsx";
import { SeriesBar } from "./SeriesBar.tsx";

export function SeriesRows({ series, pack }: { series: Series[]; pack: string }) {
  if (series.length === 0) return null;
  return (
    <section className="ov-section series" data-section="series" aria-labelledby="h-series">
      <h2 id="h-series">Series</h2>
      <ul className="series-list">
        {series.map((s) => (
          <li key={`${s.stack}|${s.prefix}`} className="series-row" data-stack={s.stack} data-prefix={s.prefix} data-active={s.active ? "true" : "false"}>
            <span className="series-name"><CombinationLink pack={pack} stack={s.stack} label={s.label} /> <span className="small">{s.prefix} on <MachineLink machine={s.machine} /></span></span>
            <SeriesBar series={s} pack={pack} />
            <span className="small series-count">{s.done} of {s.size} done</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
