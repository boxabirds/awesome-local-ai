// The ranking as a picture (headed "Score": the app does not say how a figure is made): for each combination a dot for every run's score of record, a bar for its median and
// its lowest-to-highest range, on one axis from 0 to the suite's total. Neighbours the evidence can't separate are
// bracketed. The table below it carries the same figures in full.
import type { ScorePlot as Plot } from "../../../shared/dashboardView.ts";
import { combinationHref } from "../../../shared/routes.ts";

const W = 760, ROW = 28, TOP = 26, LABEL = 250, AXIS_L = LABEL + 10, AXIS_R = W - 70, DOT = 4.5, MEDIAN_H = 9, TICKS = 3;

export function ScorePlot({ plot }: { plot: Plot }) {
  if (!plot.rows.length || !plot.total) return null;
  const total = plot.total;
  const x = (v: number) => AXIS_L + (v / total) * (AXIS_R - AXIS_L);
  const H = TOP + plot.rows.length * ROW + 24;
  const rowOf = (stack: string) => plot.rows.findIndex((r) => r.stack === stack);
  const ticks = Array.from({ length: TICKS }, (_, i) => Math.round((total * i) / (TICKS - 1)));
  const summary = plot.rows.map((r) => `${r.label}: median ${r.median} of ${total}, range ${r.min} to ${r.max}, ${r.n} run${r.n === 1 ? "" : "s"}`).join("; ");
  return (
    <section className="ov-section score-plot" data-section="scores" aria-labelledby="h-scores">
      <h2 id="h-scores">Score <span className="small">median and range; a dot per run; out of {total}</span></h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score by combination. ${summary}`} className="plot">
        {ticks.map((t) => <g key={t}><line className="plot-grid" x1={x(t)} x2={x(t)} y1={TOP - 8} y2={H - 22} /><text className="plot-tick" x={x(t)} y={H - 6} textAnchor="middle">{t}</text></g>)}
        {plot.rows.map((r, i) => {
          const y = TOP + i * ROW + ROW / 2;
          return (
            <g key={r.stack} data-stack={r.stack}>
              <a href={combinationHref(r.pack, r.stack)}><text className="plot-label" x={LABEL} y={y + 4} textAnchor="end">{r.label}</text></a>
              <line className="plot-range" x1={x(r.min)} x2={x(r.max)} y1={y} y2={y} />
              {r.dots.map((d, k) => <circle key={k} className="plot-dot" cx={x(d)} cy={y} r={DOT} />)}
              <rect className="plot-median" x={x(r.median) - 1.5} y={y - MEDIAN_H} width={3} height={MEDIAN_H * 2} />
              <text className="plot-n" x={AXIS_R + 14} y={y + 4}>n={r.n}</text>
            </g>
          );
        })}
        {plot.closeCalls.map(([a, b]) => {
          const [ia, ib] = [rowOf(a), rowOf(b)];
          if (ia < 0 || ib < 0) return null;
          const [top, bottom] = [TOP + Math.min(ia, ib) * ROW + 6, TOP + Math.max(ia, ib) * ROW + ROW - 6];
          return <path key={`${a}|${b}`} className="plot-close" data-pair={`${a}|${b}`} d={`M ${W - 18} ${top} h 8 v ${bottom - top} h -8`} />;
        })}
      </svg>
      {plot.closeCalls.length ? <p className="small plot-note">The brackets mark neighbours the runs so far can't separate.</p> : null}
    </section>
  );
}
