// The score as a picture, with the reading of it in words above: each dot is one finished run's score out of the suite's
// total, the black bar is the middle run, the grey line runs from the lowest to the highest; further right is better. The
// scale starts at the tens below the lowest ordinary dot, and a run far below the rest is pinned at the left edge
// (hollow) so one bad run doesn't squash the others. Chains of neighbours the runs so far can't separate are bracketed.
// (Headed "Score": the app does not say how a figure is made.)
import type { ScorePlot as Plot, ScorePlotRow } from "../../../shared/dashboardView.ts";
import { combinationHref } from "../../../shared/routes.ts";
import { scoreStyle } from "./SeriesBar.tsx";

const W = 760, ROW = 30, TOP = 14, LABEL = 235, AXIS_L = LABEL + 26, AXIS_R = W - 150, DOT = 4.5, MEDIAN_H = 10, STACK_STEP = 6, EDGE = 8;
const WIDE_SPAN = 40, WIDE_STEP = 10, NARROW_STEP = 5;

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const runs = (n: number) => `${n} run${n === 1 ? "" : "s"}`;

const rowTip = (r: ScorePlotRow, total: number) =>
  `${r.label}: ${runs(r.n)} scored ${r.dots.join(", ")} out of ${total}. The middle run scored ${fmt(r.median)}; the lowest ${r.min}, the highest ${r.max}.`;

export function ScorePlot({ plot }: { plot: Plot }) {
  if (!plot.rows.length || !plot.total) return null;
  const { total, axisMin } = plot;
  const span = total - axisMin;
  const x = (v: number) => AXIS_L + ((Math.min(Math.max(v, axisMin), total) - axisMin) / span) * (AXIS_R - AXIS_L);
  const off = (v: number) => v < axisMin;
  const H = TOP + plot.rows.length * ROW + 30;
  const step = span > WIDE_SPAN ? WIDE_STEP : NARROW_STEP;
  const ticks: number[] = [];
  for (let t = axisMin; t < total; t += step) ticks.push(t);
  ticks.push(total);
  const rowOf = (stack: string) => plot.rows.findIndex((r) => r.stack === stack);
  const summary = plot.rows.map((r) => `${r.label}: middle ${fmt(r.median)} of ${total}, lowest ${r.min}, highest ${r.max}, ${runs(r.n)}`).join("; ");
  return (
    <section className="ov-section score-plot" data-section="scores" aria-labelledby="h-scores">
      <h2 id="h-scores">Score <span className="small">out of {total} hidden tests</span></h2>
      <div className="plot-narrative" data-narrative>
        {plot.narrative.map((s, i) => <p key={i} className={i === 0 ? "plot-lead" : undefined}>{s}</p>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score by combination. ${summary}`} className="plot">
        {ticks.map((t) => <g key={t}><line className="plot-grid" x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H - 24} /><text className="plot-tick" x={x(t)} y={H - 8} textAnchor="middle">{t}</text></g>)}
        {plot.rows.map((r, i) => {
          const y = TOP + i * ROW + ROW / 2;
          const counts = new Map<number, number>();
          return (
            <g key={r.stack} data-stack={r.stack} data-tip={rowTip(r, total)}>
              <a href={combinationHref(r.pack, r.stack)}><text className="plot-label" x={LABEL} y={y + 4} textAnchor="end">{r.label}</text></a>
              <line className="plot-range" x1={x(r.min)} x2={x(r.max)} y1={y} y2={y} />
              {off(r.min) ? <path className="plot-edge" d={`M ${AXIS_L - EDGE} ${y} l ${EDGE} -4 v 8 z`} /> : null}
              {r.dots.map((d, k) => {
                const seen = counts.get(d) ?? 0;
                counts.set(d, seen + 1);
                const same = r.dots.filter((v) => v === d).length;
                const dy = (seen - (same - 1) / 2) * STACK_STEP;
                return <circle key={k} className={off(d) ? "plot-dot plot-dot-off" : "plot-dot"} cx={x(d)} cy={y + dy} r={DOT} />;
              })}
              <rect className="plot-median" x={x(r.median) - 1.5} y={y - MEDIAN_H} width={3} height={MEDIAN_H * 2} />
              <text className="plot-score" x={AXIS_R + 16} y={y + 4} style={scoreStyle(r.median, total)}>{fmt(r.median)}/{total}</text>
              <text className="plot-runs" x={AXIS_R + 74} y={y + 4}>{runs(r.n)}</text>
            </g>
          );
        })}
        {plot.groups.map((g) => {
          const idx = g.map(rowOf).filter((i) => i >= 0);
          if (idx.length < 2) return null;
          const [top, bottom] = [TOP + Math.min(...idx) * ROW + 6, TOP + Math.max(...idx) * ROW + ROW - 6];
          return <path key={g.join("|")} className="plot-close" data-group={g.join("|")} data-tip={`These can't be told apart yet: ${g.map((s) => plot.rows[rowOf(s)].label).join(", ")}.`} d={`M ${W - 22} ${top} h 8 v ${bottom - top} h -8`} />;
        })}
      </svg>
      <p className="small plot-key">
        <span className="key-dot" /> one run · <span className="key-median" /> the middle run · <span className="key-range" /> lowest to highest
        {plot.groups.length ? <> · <span className="key-bracket" /> can't be told apart yet</> : null}
        {plot.offScale.length ? <> · <span className="key-dot key-off" /> off the scale</> : null}
      </p>
    </section>
  );
}
