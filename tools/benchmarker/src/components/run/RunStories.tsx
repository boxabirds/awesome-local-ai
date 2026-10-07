// The run's stories in one table: for each story in scope its own held-out result, its title (a link to its story run),
// where its time went, and what it cost. The run's totals sit above it. A story being built or not yet reached keeps its
// row, empty, with a light italic word for it.
import type { ReactNode } from "react";
import type { Row, Usage } from "../../../shared/types.ts";
import { isCloud, runTimeBars, runTotals, interventionsOf, storyResults, storyTitle, whyMissing, whyRunMissing, type StoryResult } from "../../../shared/runView.ts";
import { conversationHref, storyRunHref } from "../../../shared/routes.ts";
import { StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { CollapsedMark, InterventionMark, interventionHref } from "../RunMarks.tsx";
import { short } from "../UsageCells.tsx";
import { StoryJudgeLink } from "../JudgeCell.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration, qualityClass } from "../../format.ts";
import { Missing, NotApplicable, Section, Stat, Term, full } from "./bits.tsx";
import { squareClass } from "./HeldOutAndJobs.tsx";
import { EngineSpeed, pct, speed } from "./RunCost.tsx";
import { conversationPartHref, SegmentLegend, SplitBar } from "./SplitBar.tsx";

/** The one thing said of a story with no breakdown: it isn't available. Its own total still is. */
export const NO_SPLIT = "No time breakdown for this story.";

/** What an empty row says: the story is being built, or hasn't been reached. Nothing else. */
const ROW_STATE: Partial<Record<StoryResult["state"], string>> = { building: "in progress", unbuilt: "pending" };

/** A usage figure, or Missing with why. */
const num = (v: number | null | undefined, show: (n: number) => string, u: Usage, what: Parameters<typeof whyMissing>[1]) =>
  v == null ? <Missing why={whyMissing(u, what)} /> : show(v);

/** The figures after the time: each a column, in this order. */
const FIGURES: { term: keyof typeof GLOSSARY; label?: string; cls?: string; cell: (u: Usage, cloud: boolean) => ReactNode }[] = [
  { term: "calls", cell: (u) => num(u.calls, full, u, "story") },
  { term: "outTokens", cell: (u) => num(u.outTokens, full, u, "story") },
  { term: "inputRead", cell: (u) => num(u.readTokens, short, u, "story") },
  { term: "cached", cell: (u) => (u.readTokens && u.cacheRead != null ? pct(u.cacheRead / u.readTokens) : <Missing why={whyMissing(u, "cached")} />) },
  { term: "tokS", cls: "tok-s", cell: (u) => num(u.tokS, speed, u, "story") },
  { term: "draftAcceptance", label: "Draft", cls: "draft", cell: (u, cloud) => (cloud ? <NotApplicable /> : num(u.draftAcceptance, pct, u, "draft")) },
];

/** The engine's own generation and reading speeds for a story, for the tok/s cell's hover (a cloud model has none). */
function engineTip(u: Usage, cloud: boolean): string | undefined {
  if (cloud || (u.decodeTokS == null && u.prefillTokS == null)) return undefined;
  const part = (name: string, v: number | null | undefined) => (v == null ? `${name} not timed` : `${name} ${speed(v)} tok/s`);
  return `${part("generation", u.decodeTokS)} · ${part("reading", u.prefillTokS)}`;
}

export function RunStories({ run, rows, judgeUrl }: { run: Row; rows: Row[]; judgeUrl: string }) {
  const t = runTotals(run);
  const cloud = isCloud(run);
  const { bars, scaleSeconds } = runTimeBars(run);
  const results = storyResults(run);
  const or = (v: number | null, show: (n: number) => string, why: Parameters<typeof whyRunMissing>[1]) =>
    v === null ? <Missing why={whyRunMissing(run, why)} /> : show(v);
  return (
    <Section term="runStories" id="stories"
      aside={<span className="small">{bars.length ? `one scale: the longest story, ${duration(scaleSeconds)} · ` : ""}over {t.stories} {t.stories === 1 ? "story" : "stories"}</span>}>
      <div className="stats">
        <Stat term="outTokens">{or(t.outTokens, short, "tokens")}</Stat>
        <Stat term="inputRead">{or(t.readTokens, short, "tokens")}</Stat>
        <Stat term="calls">{or(t.calls, full, "tokens")}</Stat>
        <Stat term="tokS">{or(t.tokS, speed, "speed")}</Stat>
        <Stat term="compactions">{or(t.compactions, String, "counter")}</Stat>
        <Stat term="nudges">{or(t.nudges, String, "counter")}</Stat>
      </div>
      <EngineSpeed decode={t.decodeTokS} prefill={t.prefillTokS} whyDecode={whyRunMissing(run, "model-speed")} whyPrefill={whyRunMissing(run, "model-speed")} cloud={cloud} />
      {results.length === 0 ? <p className="rp-empty">No stories in scope are known for this run.</p> : <>
        <SegmentLegend />
        <div className="table-scroll">
          <table className="rp-table stories-table" aria-label="Stories">
            <colgroup>
              <col className="c-square" /><col className="c-held" /><col className="c-title" /><col />
              <col className="c-time" />{FIGURES.map((f) => <col key={f.term} className={`c-${f.term}`} />)}<col className="c-all" />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Result" />
                <th><Term id="storyHeldOut">Held-out</Term></th>
                <th>Story</th>
                <th><Term id="timeSplit">Where the time went</Term></th>
                <th className="n"><Term id="agentTime" /></th>
                {FIGURES.map((f) => <th key={f.term} className="n"><Term id={f.term}>{f.label}</Term></th>)}
                <th aria-label="Across runs" />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const b = bars.find((x) => x.id === r.id);
                const s = run.stories.find((x) => x.id === r.id);
                const title = b?.title || storyTitle(run, rows, r.id);
                const u = s?.usage ?? null;
                return (
                  <tr className="rp-bar-row" key={r.id} data-story={r.id} data-state={r.state}>
                    <td className="rs-cell">
                      <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>
                        <span className={squareClass(r)} aria-hidden="true" data-tip={r.tip} />
                        <span className="sr-only">{r.tip}</span>
                      </StoryRunLink>
                    </td>
                    <td className="held-cell">{r.state === "result" ? <span className={`held ${qualityClass(r.passed / r.total)}`}>{r.passed}/{r.total}</span> : null}</td>
                    <td className="rp-bar-label">
                      <div className="label-line">
                        <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>{r.id}. {title || `story ${r.id}`}</StoryRunLink>
                        <CollapsedMark story={s} />
                        <InterventionMark list={interventionsOf(run, r.id)} compact to={interventionHref(run, r.id)} />
                      </div>
                    </td>
                    <td className="bar-cell">
                      <span className="bar-track">
                        {!b ? <span className="row-state">{ROW_STATE[r.state] ?? ""}</span>
                          : b.split ? (
                            // The bar is a second way for the mouse: into the story's conversation when the warehouse has it (each
                            // part at its own section), else to the story run's page; the keyboard has the title's link.
                            <a className="bar-link" data-to={b.story.hasConversation ? "conversation" : "storyRun"} href={b.story.hasConversation ? conversationHref(run.pack, run.stack, run.runId, b.id) : storyRunHref(run.pack, run.stack, run.runId, b.id)} tabIndex={-1} aria-hidden="true">
                              <SplitBar split={b.split} usage={b.usage} scaleSeconds={scaleSeconds} label={`story ${b.id}: ${duration(b.split.wall)}`} hrefOf={conversationPartHref(run, b.story)} />
                            </a>
                          ) : <span className="no-split"><Missing why={NO_SPLIT} /></span>}
                      </span>
                    </td>
                    <td className="rp-bar-total num">{!b ? "" : b.split ? duration(b.split.wall) : b.usage?.agentSeconds != null ? duration(b.usage.agentSeconds) : ""}</td>
                    {!s ? FIGURES.map((f) => <td key={f.term} className="n" />)
                      : u ? FIGURES.map((f) => <td key={f.term} className={`n ${f.cls ?? ""}`} data-tip={f.cls === "tok-s" ? engineTip(u, cloud) : undefined}>{f.cell(u, cloud)}</td>)
                      : <td colSpan={FIGURES.length} className="no-usage"><Missing why={whyMissing(null, "story")} /> no usage recorded for this story</td>}
                    <td className="rp-bar-check">
                      <span className="rp-bar-story" data-tip={GLOSSARY.storyInEveryCombination.what}><StoryLink pack={run.pack} story={r.id}>all runs</StoryLink></span>
                      {s ? <StoryJudgeLink row={run} url={judgeUrl} story={s} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
    </Section>
  );
}
