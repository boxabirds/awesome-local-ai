// A combination's series: the run sets it has accumulated, newest work first. One series is one experiment — a
// different engine build, quantisation or setting — so its runs are the only ones comparable with each other, and
// the page's headline figures are over the current one (shared/stats.ts). Shown only where there is more than one:
// with a single series the page already reads as that series' page.
import type { Row } from "../../../shared/types.ts";
import { seriesOf } from "../../../shared/dashboardView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { SeriesBar, scoreStyle } from "../overview/SeriesBar.tsx";
import { Section } from "../run/bits.tsx";

const runCount = (n: number) => `${n} run${n === 1 ? "" : "s"}`;

/** What state the series is in, in the page's words: what is left to do, or that it is done. "running" and "queued"
 * describe the runs, so they never take an s. */
function standing(done: number, size: number, running: number, queued: number): string {
  if (running || queued) {
    return [`${done} of ${size} finished`, running ? `${running} running` : "", queued ? `${queued} queued` : ""].filter(Boolean).join(" · ");
  }
  return `${runCount(size)}, finished`;
}

export function SeriesPanel({ runs, pack, current }: { runs: Row[]; pack: string; current: string }) {
  const series = seriesOf(runs);
  if (series.length < 2) return null;
  // The current series (the headline's) first; seriesOf has already put work in hand before the rest.
  const ordered = series.toSorted((a, b) => Number(b.prefix === current) - Number(a.prefix === current));
  return (
    <Section term="series" id="series" heading="Series" aside={<span className="small">each a separate experiment; the figures above are the current one&apos;s</span>}>
      <ul className="series-list">
        {ordered.map((s) => {
          const running = s.runs.filter((r) => r.state === "running").length;
          const queued = s.runs.filter((r) => r.state === "queued").length;
          const isCurrent = s.prefix === current;
          return (
            <li key={s.prefix} className="series-row" data-prefix={s.prefix} data-current={isCurrent ? "true" : "false"}>
              <span className="series-name">
                <b className="mono">{s.prefix}</b>
                {isCurrent ? <span className="series-current" data-tip={GLOSSARY.currentSeries.what}>{GLOSSARY.currentSeries.name}</span> : null}
              </span>
              <SeriesBar series={s} pack={pack} />
              <span className="series-score"
                    data-tip={s.score ? `Median of ${runCount(s.score.n)} scored, ${s.score.min} to ${s.score.max}` : "No run of this series is scored yet."}
                    style={s.score && s.score.total ? scoreStyle(s.score.median, s.score.total) : undefined}>
                {s.score ? <>{Number.isInteger(s.score.median) ? s.score.median : s.score.median.toFixed(1)}{s.score.total ? `/${s.score.total}` : ""}</> : "—"}
              </span>
              <span className="small series-standing">{standing(s.done, s.size, running, queued)}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
