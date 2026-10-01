// Every combination's attempt at the story, as one table so the columns line up across combinations: per combination
// a heading row, its median and range over its finished runs, then each run's story run (the time bar on the page's
// one scale, the measures, the 10% divergence flag against the combination's median, its held-out results), then the
// runs that haven't built it. One story run can be set as the comparison: the others then read as percentages of it.
import type { Row, Story } from "../../../shared/types.ts";
import {
  STORY_MEASURES, compareParam, relativeTo,
  type Comparison, type Entry, type Group, type StoryMeasure, type StoryPageView, type SummaryKey,
} from "../../../shared/storyView.ts";
import { heldOutState, type Divergence } from "../../../shared/combinationView.ts";
import { interventionsOf, STATUS_ICON } from "../../../shared/runView.ts";
import { InterventionMark } from "../RunMarks.tsx";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { StorySplitBar } from "../TimeBars.tsx";
import { duration } from "../../format.ts";
import { LiveTag, Missing, SHOW, Term, termName, termTip, whyNoValue } from "./parts.tsx";

const PERCENT = 100;
/** Columns before the measures: the story run (with its comparison control), its bar. */
const LEAD_COLS = 2;
const COLS = LEAD_COLS + STORY_MEASURES.length;
const SUMMARISED = STORY_MEASURES.filter((m) => m.summarised);
const REST = STORY_MEASURES.filter((m) => !m.summarised);

const signed = (d: Divergence) => (Number.isFinite(d.by) ? `${d.by > 0 ? "+" : "−"}${Math.round(Math.abs(d.by) * PERCENT)}%` : "above a median of 0");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The divergence flag: filled above the median, outlined below; the hover says by how much and why. */
function Flag({ d, m, g, e }: { d: Divergence; m: StoryMeasure; g: Group; e: Entry }) {
  const med = g.summary[m.key as SummaryKey].median!;
  const mech = e.mechanism;
  const why = mech ? ` Mechanism: ${mech.label}. ${mech.fired.length ? mech.fired.map((f) => `${f.label}: ${f.evidence}`).join(" · ") : mech.evidence}` : "";
  const tip = `${signed(d)} ${d.direction} the combination's median ${termName(m.term).toLowerCase()} for this story (${SHOW[m.key](med.median)} over ${plural(med.n, "finished run")}).${why}`;
  return <span className={`flag ${d.direction}`} tabIndex={0} role="img" aria-label={`differs from the combination's median: ${mech?.label ?? d.direction}`} data-flag={m.key} data-tip={tip}>⚑</span>;
}

/** A recorded story run's value on a measure: its own, or a percentage of the comparison's; missing with why. */
function Value({ story, m, base, baseRun }: { story: Story; m: StoryMeasure; base: Story | null; baseRun: Row | null }) {
  const v = m.value(story);
  if (m.key === "heldOut") {
    if (v === null) return <Missing why={whyNoValue(story, m.key)} />;
    const state = heldOutState(story, false);
    return <span className={`ho h-${state}`}><i className={`sq q-${state === "none" ? "unbuilt" : state}`} aria-hidden="true" />{story.ownPassed ?? 0}/{story.ownTotal}</span>;
  }
  if (v === null) return <Missing why={whyNoValue(story, m.key)} />;
  if (!base || !baseRun || !m.relative) return <>{SHOW[m.key](v)}</>;
  const bv = m.value(base);
  const r = relativeTo(v, bv);
  if (r.kind === "percent") return <span className="pct" tabIndex={0} data-tip={`${SHOW[m.key](v)}: ${r.percent}% of ${baseRun.runId}'s ${SHOW[m.key](bv!)}`}>{r.percent}%</span>;
  if (r.kind === "own") return <span className="own" tabIndex={0} data-tip={r.why}>{SHOW[m.key](r.value)}</span>;
  return <Missing why={whyNoValue(story, m.key)} />;
}

function Cell({ e, m, g, cmp }: { e: Entry; m: StoryMeasure; g: Group; cmp: Comparison }) {
  const a = e.attempt;
  let body;
  if (a.kind === "recorded") {
    const isBase = cmp.kind === "ok" && cmp.entry === e;
    const base = cmp.kind === "ok" && !isBase ? cmp.entry : null;
    body = <Value story={a.story} m={m} base={base?.attempt.story ?? null} baseRun={base?.run ?? null} />;
  } else if (a.kind === "building") {
    const live = m.key === "minutes" ? a.agentMinutes : m.key === "calls" ? a.calls : m.key === "outTokens" ? a.outputTokens : null;
    body = live !== null
      ? <span className="live-n" tabIndex={0} data-tip={`Live: ${termName(m.term).toLowerCase()} so far on this story. The record arrives when the story ends.${live === 0 && m.key !== "minutes" ? " Some clients (Claude) count calls and tokens only when a story ends, so 0 here can mean not counted yet." : ""}`}>{SHOW[m.key](live)}</span>
      : <Missing why="Being built now: this figure arrives with the story's record when it ends." />;
  } else {
    body = <Missing why="Built (its latest-build square says so), but the story's record hasn't arrived yet." />;
  }
  const d = m.summarised ? e.divergence[m.key as SummaryKey] : null;
  return (
    <td className={`n${d ? " flagged" : ""}`} data-measure={m.key}>
      {body}{d ? <> <Flag d={d} m={m} g={g} e={e} /></> : null}
      {m.key === "heldOut" ? <Latest e={e} /> : null}
    </td>
  );
}

/** Under the held-out result: the same story's tests against the run's latest build, live. */
function Latest({ e }: { e: Entry }) {
  const q = e.latest;
  const body = !q || !q.total
    ? <Missing why={q?.state === "running" ? "Being built now: no build to test yet." : "No held-out result against the run's latest build."} />
    : <span className="live-n" tabIndex={0} data-tip={`${termTip("storyLatestBuild")} ${q.passed ?? 0} of ${q.total} pass.`}><i className={`sq q-${q.state}`} aria-hidden="true" />{q.passed ?? 0}/{q.total}</span>;
  return <span className="latest" data-latest>latest {body}</span>;
}

function RunCell({ e, storyId, cmp, onCompare }: { e: Entry; storyId: string; cmp: Comparison; onCompare: (p: string | undefined) => void }) {
  const r = e.run;
  return (
    <th scope="row" className="sp-run">
      <span className="sp-run-line"><RunLink pack={r.pack} stack={r.stack} runId={r.runId} /> · <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId} /></span>
      <span className="sp-run-meta">
        <span className={`s-${r.status}`} data-tip={`${termName("runStatus")}: ${r.status}${r.statusNote ? ` (${r.statusNote})` : ""}`}>{STATUS_ICON[r.status]} {r.status}</span>
        {" · "}<MachineLink machine={r.machine} host={r.host} />
        {interventionsOf(r, storyId).length ? <> <InterventionMark list={interventionsOf(r, storyId)} compact /></> : null}
        {e.attempt.kind === "building" ? <> · building <LiveTag /></> : null}
        {e.attempt.kind === "unrecorded" ? <> · <span className="small">no record yet</span></> : null}
      </span>
      <span className="sp-compare"><CompareButton e={e} cmp={cmp} onCompare={onCompare} /></span>
    </th>
  );
}

function Bar({ e, scale }: { e: Entry; scale: number }) {
  const split = e.attempt.kind === "recorded" ? e.attempt.story.usage?.split ?? null : null;
  if (!split) {
    const why = e.attempt.kind === "recorded" ? "No time breakdown for this story run."
      : e.attempt.kind === "building" ? "Being built now: the breakdown arrives with the story's record." : "The story's record hasn't arrived yet.";
    return <span className="no-split"><Missing why={why} /></span>;
  }
  return <span className="bar-track"><StorySplitBar split={split} usage={e.attempt.kind === "recorded" ? e.attempt.story.usage : null} scaleSeconds={scale} label={`${e.run.runId}: ${duration(split.wall)}`} /></span>;
}

function CompareButton({ e, cmp, onCompare }: { e: Entry; cmp: Comparison; onCompare: (p: string | undefined) => void }) {
  const isBase = cmp.kind === "ok" && cmp.entry === e;
  if (isBase) {
    return <><span className="tag tag-compare">comparison</span><button type="button" className="sp-btn" onClick={() => onCompare(undefined)}>Clear</button></>;
  }
  if (e.attempt.kind !== "recorded") return null;
  return <button type="button" className="sp-btn quiet" data-tip={termTip("setComparison")} aria-label={`Set ${e.run.label} ${e.run.runId} as comparison`} onClick={() => onCompare(compareParam(e.run.stack, e.run.runId))}>{termName("setComparison")}</button>;
}

function SummaryRow({ g, storyId }: { g: Group; storyId: string }) {
  const none = g.finishedRecorded === 0;
  return (
    <tr className="sp-median" data-median={g.stack}>
      <th scope="row" colSpan={LEAD_COLS}>
        <Term id="storyCombinationMedian" /> <span className="small">over {plural(g.finishedRecorded, "finished run")}</span>
      </th>
      {SUMMARISED.map((m) => {
        const s = g.summary[m.key as SummaryKey].spread;
        if (!s) {
          const why = none ? `No finished run of this combination has recorded story ${storyId}, so there is no median: running runs aren't in it.` : `No finished run of this combination recorded its ${termName(m.term).toLowerCase()} for this story.`;
          return <td key={m.key} className="n" data-measure={m.key}><Missing why={why} /></td>;
        }
        return (
          <td key={m.key} className="n" data-measure={m.key} data-tip={`Median ${SHOW[m.key](s.median)}, from ${SHOW[m.key](s.min)} to ${SHOW[m.key](s.max)}, over ${plural(s.n, "finished run")}.`}>
            <span className="spread"><b className="median">{SHOW[m.key](s.median)}</b>{s.min !== s.max ? <span className="range">{SHOW[m.key](s.min)}–{SHOW[m.key](s.max)}</span> : null}<span className="n-runs">n={s.n}</span></span>
          </td>
        );
      })}
      <td colSpan={REST.length} />
    </tr>
  );
}

function GroupRows({ g, storyId, scale, cmp, onCompare }: { g: Group; storyId: string; scale: number; cmp: Comparison; onCompare: (p: string | undefined) => void }) {
  return (
    <tbody data-stack={g.stack}>
      <tr className="sp-group">
        <th scope="colgroup" colSpan={COLS}>
          <CombinationLink pack={g.pack} stack={g.stack} label={g.label} />
          <span className="small"> on {g.machines.map((m, i) => <span key={m.machine}>{i ? ", " : ""}<MachineLink machine={m.machine} host={m.host} /></span>)}</span>
        </th>
      </tr>
      {g.entries.length ? <SummaryRow g={g} storyId={storyId} /> : null}
      {g.entries.map((e) => (
        <tr key={e.run.runId} className="sp-entry" data-run={e.run.runId} data-attempt={e.attempt.kind} data-comparison={cmp.kind === "ok" && cmp.entry === e ? "true" : undefined}>
          <RunCell e={e} storyId={storyId} cmp={cmp} onCompare={onCompare} />
          <td className="sp-bar">
            <Bar e={e} scale={scale} />
          </td>
          {STORY_MEASURES.map((m) => <Cell key={m.key} e={e} m={m} g={g} cmp={cmp} />)}
        </tr>
      ))}
      {g.notBuilt.length ? (
        <tr className="sp-not-built">
          <td colSpan={COLS}>
            <Term id="storyNotBuilt" />:{" "}
            {g.notBuilt.map(({ run, why }, i) => (
              <span key={run.runId} data-run={run.runId}>{i ? " · " : ""}<RunLink pack={run.pack} stack={run.stack} runId={run.runId} /> <span className={`small s-${run.status}`} tabIndex={0} data-tip={why}>{run.status}</span></span>
            ))}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

export function ByCombination({ view, storyId, cmp, onCompare }: { view: StoryPageView; storyId: string; cmp: Comparison; onCompare: (p: string | undefined) => void }) {
  return (
    <section className="sp-section" data-section="combinations" aria-labelledby="h-combinations">
      <div className="sp-head">
        <h2 id="h-combinations"><Term id="storyByCombination" /></h2>
        <span className="small">quality first: combinations by their median held-out result, then agent time</span>
      </div>
      {cmp.kind === "ok" ? (
        <p className="compare-note" data-compare="ok">
          Numbers are percentages of <b><RunLink pack={cmp.entry.run.pack} stack={cmp.entry.run.stack} runId={cmp.entry.run.runId} label={cmp.entry.run.label} /></b>'s (on <MachineLink machine={cmp.entry.run.machine} host={cmp.entry.run.host} />), shown in full on its row; where its number is 0 or missing, each run shows its own. Held-out stays a count. Medians are in their own units.{" "}
          <button type="button" className="sp-btn" onClick={() => onCompare(undefined)}>Clear comparison</button>
        </p>
      ) : cmp.kind === "unusable" ? (
        <p className="compare-note warn-note" data-compare="unusable">
          The comparison in the address can't be used here: {cmp.why} Numbers are shown as they are.{" "}
          <button type="button" className="sp-btn" onClick={() => onCompare(undefined)}>Clear comparison</button>
        </p>
      ) : null}
      {view.groups.length === 0 ? <p className="sp-empty">No run of this pack version has this story in scope.</p> : (
        <div className="sp-table-wrap">
          <table className="sp-table" aria-label={`Story ${storyId} by combination`}>
            <thead>
              <tr>
                <th scope="col" className="sp-run">Story run <span className="th-sub"><Term id="setComparison">and comparison</Term></span></th>
                <th scope="col" className="sp-bar"><Term id="timeSplit">Time</Term></th>
                {STORY_MEASURES.map((m) => (
                  <th key={m.key} scope="col" className="n" data-measure={m.key}>
                    <Term id={m.term} />
                    {m.key === "heldOut" ? <span className="th-sub"><Term id="storyLatestBuild">and latest</Term> <LiveTag /></span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            {view.groups.map((g) => <GroupRows key={g.stack} g={g} storyId={storyId} scale={view.scaleSeconds} cmp={cmp} onCompare={onCompare} />)}
          </table>
        </div>
      )}
      <p className="sp-key small">
        <span className="flag above" aria-hidden="true">⚑</span> <Term id="divergence">more than 10% from the combination's median</Term> (filled above it, outlined below), with its mechanism on hover.
        {" "}<i className="sq q-ok" aria-hidden="true" /> held-out colours: all pass, some, none. <LiveTag /> figures are provisional.
        {view.groups.some((g) => g.entries.some((e) => e.run.interventions?.length)) ? <> <span className="intervened compact" aria-hidden="true">✱</span> <Term id="intervened">intervened</Term>: done by hand, still counted.</> : null}
      </p>
    </section>
  );
}
