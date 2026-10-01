// The combination's runs × stories: one row per run, one cell per story run (a link to it). The cell's colour is
// always its held-out result; its text is the metric chosen. A cell more than 10% from its story's median carries a
// flag whose hover gives the mechanism and the numbers that triggered it. Arrow keys move between cells; Enter opens one.
import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { Row } from "../../../shared/types.ts";
import type { TermId } from "../../../shared/glossary.ts";
import { buildMatrix, DIVERGENCE, MECHANISM_TERM, METRICS, runTotal, type Matrix, type MatrixCell, type Metric, type StoryMedian } from "../../../shared/combinationView.ts";
import { scoreOfRecord, unscoredReason } from "../../../shared/stats.ts";
import { finalScoreNote } from "../../../shared/finalScore.ts";
import { duration } from "../../format.ts";
import { RunLink, StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { Missing, Term, termName, termTip } from "./Term.tsx";
import { InterventionMark, InvalidTag } from "../RunMarks.tsx";
import { interventionsOf } from "../../../shared/runView.ts";

const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const SPEED_DECIMALS = 0;

/** Each metric's glossary term and how a value, a median and a run's total read. */
const METRIC_VIEW: Record<Metric, { term: TermId; label: string; cell: (v: number, c?: MatrixCell) => string; total: (v: number, run: Row) => string }> = {
  minutes: { term: "agentTime", label: "minutes", cell: (v) => (v > 0 && v < 1 ? "<1m" : `${Math.round(v)}m`), total: (v) => duration(v * SECONDS_PER_MINUTE) },
  outTokens: { term: "outTokens", label: "output tokens", cell: (v) => short(Math.round(v)), total: (v) => short(Math.round(v)) },
  calls: { term: "calls", label: "tool calls", cell: (v) => String(Math.round(v)), total: (v) => String(Math.round(v)) },
  heldOut: {
    term: "storyRunHeldOut", label: "held-out",
    cell: (v, c) => (c?.story?.ownTotal ? `${c.story.ownPassed ?? 0}/${c.story.ownTotal}` : `${Math.round(v * PERCENT)}%`),
    total: (v, run) => `${v} of ${run.stories.filter((s) => s.ownTotal).length} pass`,
  },
  tokS: { term: "tokS", label: "tok/s", cell: (v) => v.toFixed(SPEED_DECIMALS), total: (v) => v.toFixed(SPEED_DECIMALS) },
};

export const metricLabel = (m: Metric) => METRIC_VIEW[m].label;

const STATUS_ICON: Record<string, string> = { finished: "✓", running: "▶", queued: "⏸", failed: "✕", cancelled: "⊘", stopped: "■", unknown: "?" };
const HELD_OUT_WORD: Record<MatrixCell["heldOut"], string> = { ok: "all its held-out tests pass", part: "some of its held-out tests pass", bad: "none of its held-out tests pass", none: "held-out tests not recorded", running: "being built now", unbuilt: "not built" };

const MECHANISM_LIST = Object.keys(MECHANISM_TERM).join(", ");

const signed = (by: number) => (Number.isFinite(by) ? `${by > 0 ? "+" : "−"}${Math.round(Math.abs(by) * PERCENT)}%` : "above a median of 0");

function medianText(m: StoryMedian | null | undefined, metric: Metric): string {
  if (!m) return "no finished run has it";
  return metric === "heldOut" ? `${Math.round(m.median * PERCENT)}%` : METRIC_VIEW[metric].cell(m.median);
}

/** The flag's hover: how far from the median, the mechanism, and every rule that fired with its numbers. */
function flagTip(c: MatrixCell, metric: Metric, m: StoryMedian | null | undefined): string {
  const d = c.divergence!, mech = c.mechanism!;
  const head = `${signed(d.by)} ${d.direction} the story's median ${METRIC_VIEW[metric].label} (${medianText(m, metric)} over ${m?.n ?? 0} finished runs). Mechanism: ${mech.label}. `;
  const why = mech.fired.length ? mech.fired.map((f) => `${f.label}: ${f.evidence}`).join(" · ") : mech.evidence;
  return `${head}${why}`;
}

function cellTip(c: MatrixCell, run: Row, metric: Metric, m: StoryMedian | null | undefined): string {
  const where = `${run.runId} · story ${c.storyId}${c.story?.title ? ` (${c.story.title})` : ""}`;
  const marks = `${run.invalid ? " Invalid run: not in the median, never flagged." : ""}${interventionsOf(run, c.storyId).length ? ` Intervened ${interventionsOf(run, c.storyId).length}× in this story.` : ""}`;
  if (c.state === "absent") return `${where}: not built.`;
  if (c.state === "building") return `${where}: being built now.`;
  const v = c.value === null ? `— (${c.missing})` : METRIC_VIEW[metric].cell(c.value, c);
  const med = `median ${medianText(m, metric)}${m ? `, n=${m.n}` : ""}`;
  return `${where}: ${v}; ${med}. ${HELD_OUT_WORD[c.heldOut]}${c.story?.ownTotal ? ` (${c.story.ownPassed ?? 0}/${c.story.ownTotal})` : ""}.${c.divergence ? ` Flagged: ${flagTip(c, metric, m)}` : ""}${marks}`;
}

/** The run's head: its link, status, and score of record, or "—" and why; live progress is labelled live. */
function RunHead({ run }: { run: Row }) {
  const score = scoreOfRecord(run);
  const built = run.storiesWorking.squares.filter((q) => q.state !== "unbuilt" && q.state !== "running").length;
  const note = finalScoreNote(run);
  const why = run.status === "finished" ? `Unscored: ${unscoredReason(run)}.${note ? ` ${note}` : ""}` : `No score of record: the run is ${run.status}, and only a finished run is re-scored.`;
  return (
    <>
      <th scope="row" className="m-run">
        <RunLink pack={run.pack} stack={run.stack} runId={run.runId} invalid={run.invalid} />
        <span className={`m-status s-${run.status}`} data-tip={`${termName("runStatus")}: ${run.status}${run.statusNote ? ` (${run.statusNote})` : ""}`}>{STATUS_ICON[run.status] ?? "?"} {run.status}</span>
        <InterventionMark list={interventionsOf(run)} compact />
      </th>
      <td className="m-score">
        {run.invalid ? <InvalidTag invalid={run.invalid} />
          : score ? <b className="of-record" data-tip={termTip("scoreOfRecord")}>{score.passed}<span className="small">/{score.total}</span></b>
          : run.status === "finished" ? <span className="unscored" tabIndex={0} data-tip={why}>unscored</span>
          : built ? <span className="live" tabIndex={0} data-tip={`${termTip("liveBadge")} ${why}`}><span className="live-badge">live</span> {run.storiesWorking.working}/{built}</span>
          : <Missing why={why} />}
      </td>
    </>
  );
}

function MatrixCellView({ c, run, metric, m, row, col }: { c: MatrixCell; run: Row; metric: Metric; m: StoryMedian | null | undefined; row: number; col: number }) {
  const tip = cellTip(c, run, metric, m);
  const cls = `m-cell h-${c.heldOut}${c.divergence ? " flagged" : ""}`;
  if (c.state === "absent") return <td className={cls} data-row={row} data-col={col} data-state="absent" data-tip={tip} />;
  const text = c.state === "building" ? "building" : c.value === null ? "—" : METRIC_VIEW[metric].cell(c.value, c);
  return (
    <td className={cls} data-row={row} data-col={col} data-state={c.state} data-story={c.storyId} data-tip={tip}>
      <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={c.storyId}>
        <i className={`sq q-${c.heldOut === "none" ? "unbuilt" : c.heldOut}`} aria-hidden="true" />
        <span className="v">{text}</span>
        <InterventionMark list={interventionsOf(run, c.storyId)} compact focusable={false} />
        {c.divergence ? (
          <span className={`flag ${c.divergence.direction}`} data-mechanism={c.mechanism!.label} data-tip={flagTip(c, metric, m)} aria-label={`differs from median: ${c.mechanism!.label}`}>⚑</span>
        ) : null}
      </StoryRunLink>
    </td>
  );
}

/** Arrow keys move between the matrix's links, skipping empty cells; Enter follows the link (the browser does that). */
function move(table: HTMLTableElement, from: HTMLElement, key: string): HTMLAnchorElement | null {
  const td = from.closest("td[data-col]") as HTMLElement | null;
  if (!td) return null;
  const row = Number(td.dataset.row), col = Number(td.dataset.col);
  const at = (r: number, c: number) => table.querySelector<HTMLAnchorElement>(`td[data-row="${r}"][data-col="${c}"] a`);
  const rows = table.querySelectorAll("tbody tr").length, cols = table.querySelectorAll("thead th.m-story").length;
  const [dr, dc] = ({ ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] } as Record<string, [number, number]>)[key] ?? [0, 0];
  if (!dr && !dc) return null;
  for (let r = row + dr, c = col + dc; r >= 0 && r < rows && c >= 0 && c < cols; r += dr, c += dc) {
    const a = at(r, c);
    if (a) return a;
  }
  return null;
}

export function MetricSwitch({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="metric-switch" role="group" aria-label={termName("metricSwitch")}>
      <Term id="metricSwitch" className="small" />
      {METRICS.map((m) => (
        <button key={m} type="button" className="chip" aria-pressed={metric === m} data-metric={m} data-tip={termTip(METRIC_VIEW[m].term)} onClick={() => onChange(m)}>{METRIC_VIEW[m].label}</button>
      ))}
    </div>
  );
}

export function RunMatrix({ runs, metric, matrix: given }: { runs: Row[]; metric: Metric; matrix?: Matrix }) {
  const matrix = given ?? buildMatrix(runs, metric);
  const table = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<string | null>(null);   // "row:col" of the cell that holds the tab stop
  // One tab stop for the whole matrix (the active cell, else the first link); the arrows do the rest.
  useLayoutEffect(() => {
    const links = [...(table.current?.querySelectorAll<HTMLAnchorElement>("td[data-col] a") ?? [])];
    const keyOf = (a: HTMLElement) => { const td = a.closest("td") as HTMLElement; return `${td.dataset.row}:${td.dataset.col}`; };
    const stop = links.find((a) => keyOf(a) === active) ?? links[0];
    for (const a of links) a.tabIndex = a === stop ? 0 : -1;
  });
  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const next = move(e.currentTarget, e.target as HTMLElement, e.key);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  const onFocus = (e: FocusEvent<HTMLTableElement>) => {
    const td = (e.target as HTMLElement).closest("td[data-col]") as HTMLElement | null;
    if (td) setActive(`${td.dataset.row}:${td.dataset.col}`);
  };
  const titles = new Map<string, string>();
  for (const r of runs) for (const s of r.stories) if (s.title) titles.set(String(Number(s.id)), s.title);
  const view = METRIC_VIEW[metric];
  return (
    <div className="matrix-wrap">
      <table className="matrix" aria-label={termName("matrix")} ref={table} onKeyDown={onKey} onFocus={onFocus} data-metric={metric}>
        <thead>
          <tr>
            <th className="m-run" scope="col"><Term id="runsByStatus" /></th>
            <th className="m-score" scope="col"><Term id="scoreOfRecord" /></th>
            {matrix.stories.map((id) => (
              <th key={id} className="m-story" scope="col" data-story={id} data-tip={`${titles.get(id) ? `Story ${id}: ${titles.get(id)}` : `Story ${id}: not built by any run yet`}. Opens the story's page: every combination on it.`}>
                {runs[0] ? <StoryLink pack={runs[0].pack} story={id}>{id}</StoryLink> : id}
              </th>
            ))}
            <th className="m-total" scope="col"><Term id="runTotalMetric" /></th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => {
            const total = r.run.stories.length ? runTotal(r.run, metric) : null;
            return (
              <tr key={r.run.runId} data-run={r.run.runId} data-status={r.run.status} data-invalid={r.run.invalid ? "true" : undefined}>
                <RunHead run={r.run} />
                {r.cells.map((c, j) => <MatrixCellView key={c.storyId} c={c} run={r.run} metric={metric} m={matrix.medians.get(c.storyId)} row={i} col={j} />)}
                <td className="m-total">{total === null ? <Missing why="Nothing recorded for this run yet." /> : view.total(total, r.run)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="m-median">
            <th scope="row" className="m-run" colSpan={2}><Term id="storyMedian" /> <span className="small" data-tip={runs.some((r) => r.invalid) ? "Over the finished runs; invalid runs are left out." : undefined}>finished runs</span></th>
            {matrix.stories.map((id) => {
              const m = matrix.medians.get(id);
              return <td key={id} data-story={id} data-tip={m ? `Story ${id}: median ${medianText(m, metric)} over ${m.n} finished run${m.n === 1 ? "" : "s"}` : `Story ${id}: no finished run has it, so there is no median`}>{m ? medianText(m, metric) : "—"}</td>;
            })}
            <td className="m-total" />
          </tr>
        </tfoot>
      </table>
      <p className="matrix-key small">
        <span className="legend"><i className="sq q-ok" />all pass</span> <span className="legend"><i className="sq q-part" />some</span> <span className="legend"><i className="sq q-bad" />none</span>{" "}
        <span className="legend"><i className="sq q-unbuilt" />not measured</span> <span className="legend"><i className="sq q-running" />building</span>{" "}
        · colour: <Term id="storyRunHeldOut">held-out for that story</Term> · text: {view.label} · <span className="flag" aria-hidden="true">⚑</span> <Term id="divergence">more than {DIVERGENCE * PERCENT}% from the story's median</Term> (filled above it, outlined below), with its mechanism on hover ({MECHANISM_LIST}).
        {runs.some((r) => r.interventions?.length) ? <> <span className="intervened compact" aria-hidden="true">✱</span> <Term id="intervened">intervened</Term>: done by hand, still counted.</> : null}
        {runs.some((r) => r.invalid) ? <> <span className="invalid-run">struck through</span>: <Term id="invalidRun">invalid</Term>, in no figure.</> : null}
      </p>
    </div>
  );
}

