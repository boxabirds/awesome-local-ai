// This run beside another of the same combination, story by story; and the combination's other runs.
// Modest on purpose: the combination page has the full runs x stories matrix.
import { useLayoutEffect, useRef, useState } from "react";
import type { Row, Story } from "../../../shared/types.ts";
import { COMPARE_MEASURES, compareBlocks, PENDING, scoreOfRecord, signedPercent, statusView, type MeasureKey } from "../../../shared/runView.ts";
import { compareToken, parseCompareList, resolveCompareList, runKey, serializeCompareList } from "../../../shared/compareList.ts";
import { readRemember, readRemembered, writeRemember, writeRemembered } from "../../compareMemory.ts";
import { ComparePicker } from "./ComparePicker.tsx";
import { conversationPartHref, SegmentLegend, SplitBar } from "./SplitBar.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { pct, speed } from "./RunCost.tsx";
import { useAddressParam } from "../story/useAddressParam.ts";
import { RunSectionLists } from "../RunGroupHead.tsx";

const SHOW: Record<MeasureKey, (n: number) => string> = { minutes: duration, outTokens: short, calls: full, tokS: speed, decodeTokS: speed, heldOut: pct };

/** The runs compared with are in the address (?compare=v2-r4,<combination>|v2-r1), so a reload or a shared link keeps
 * them. With none there, the runs the reader last chose in this browser (if they asked to remember), else the first other
 * run of this combination that has recorded a story. ?compare=none when the reader chose no run. */
export function CompareRuns({ run, candidates, params }: { run: Row; candidates: Row[]; params?: Record<string, string> }) {
  const [param, setParam] = useAddressParam(params, "compare");
  const [remember, setRemember] = useState(readRemember);
  const fromAddress = param !== undefined ? resolveCompareList(run, parseCompareList(param), candidates) : null;
  const byKey = new Map(candidates.map((r) => [runKey(r), r]));
  const remembered = !fromAddress && remember ? readRemembered().flatMap((k) => byKey.get(k) ?? []) : [];
  const fallback = candidates.find((r) => r.stack === run.stack) ?? null;
  const chosen = fromAddress ? fromAddress.runs : remembered.length ? remembered : fallback ? [fallback] : [];
  const unknown = fromAddress?.unknown ?? [];

  const setChosen = (runs: Row[]) => {
    setParam(serializeCompareList(runs.map((r) => compareToken(run, r))));
    if (remember) writeRemembered(runs.map(runKey));
  };
  const onRemember = (on: boolean) => { setRemember(on); writeRemember(on); if (on) writeRemembered(chosen.map(runKey)); };
  const blocks = compareBlocks(run, chosen);
  // Clearing the last run takes the table away, and a page that gets that much shorter jumps to a new scroll position.
  // So the height the comparison last had is kept while nothing is chosen (a run page is its own component: a new
  // run starts with none).
  const body = useRef<HTMLDivElement>(null);
  const heldHeight = useRef(0);
  useLayoutEffect(() => { if (chosen.length && blocks.length && body.current) heldHeight.current = body.current.offsetHeight; });

  return (
    <Section term="compareRuns" id="compare">
      {candidates.length === 0 ? <p className="rp-empty">No other run in this pack and suite has recorded a story to compare with.</p> : <>
        <ComparePicker candidates={candidates} chosen={chosen} remember={remember} onRemember={onRemember}
          onAdd={(r) => setChosen([...chosen, r])} onRemove={(r) => setChosen(chosen.filter((c) => runKey(c) !== runKey(r)))} />
        {unknown.length ? <p className="small" data-unknown={unknown.join(",")}>The address names {unknown.join(", ")}, which {unknown.length === 1 ? "isn't" : "aren't"} a run in this pack and suite with a story recorded; {unknown.length === 1 ? "it is" : "they are"} left out.</p> : null}
        <div ref={body} className="compare-body" style={chosen.length === 0 ? { minHeight: heldHeight.current } : undefined}>
        {chosen.length === 0 ? <p className="rp-empty">Choose a run to compare with.</p>
          : blocks.length === 0 ? <p className="rp-empty">{chosen.length === 1 ? "Neither run has" : "None of these runs has"} recorded a story yet.</p> : <>
          <p className="small compare-key">
            One line per run in each story, this run first{chosen.map((o, i) => <span key={runKey(o)}>{i ? ", " : ": "}<RunLink pack={o.pack} stack={o.stack} runId={o.runId} /></span>)}. Under another run's figure,
            its difference from {run.runId}'s; <span className="diff flagged">marked</span> where it is more than 10%. The time bars in a story share one scale.
          </p>
          <SegmentLegend />
          <div className="table-scroll">
            <table className="rp-table compare compare-lines" aria-label={`${run.runId} against ${chosen.map((o) => o.runId).join(", ")}`}>
              <thead>
                <tr>
                  <th>Story</th>
                  <th>Run</th>
                  <th className="n"><Term id="storyHeldOut" /></th>
                  <th>Where the time went</th>
                  {COMPARE_MEASURES.filter((m) => m.key !== "heldOut").map((m) => <th key={m.key} className="n"><Term id={m.term} /></th>)}
                </tr>
              </thead>
              {blocks.map((block) => (
                <tbody key={block.id} data-story={block.id}>
                  {block.lines.map((line, i) => {
                    const { run: r, story: s } = line;
                    const mine = i === 0;
                    const missing = (what: string) => <Missing why={`${r.runId} ${s ? `has no ${what} for this story.` : "hasn't recorded this story."}`} />;
                    const cell = (key: MeasureKey, shown: string | null, what: string) => {
                      const d = line.diffs?.[key];
                      return (
                        <td key={key} className="n" data-measure={key} data-flagged={d?.flagged ? "true" : undefined}>
                          {shown !== null ? <div className="line-value">{shown}</div> : missing(what)}
                          {d && d.rel !== null ? <div className={`diff${d.flagged ? " flagged" : ""}`} tabIndex={d.flagged ? 0 : undefined} data-tip={d.flagged ? GLOSSARY.compareDiff.what : undefined}>{signedPercent(d.rel)}</div> : null}
                        </td>
                      );
                    };
                    const num = (key: MeasureKey) => { const v = COMPARE_MEASURES.find((m) => m.key === key)!.value(s ?? ({} as Story)); return s && v !== null ? SHOW[key](v) : null; };
                    return (
                      <tr key={runKey(r)} data-run={r.runId} data-story={block.id} data-this-run={mine ? "true" : undefined}>
                        {mine ? <th scope="rowgroup" rowSpan={block.lines.length} className="story-cell">{block.id}. {block.title || `story ${block.id}`}</th> : null}
                        <td className="run-cell">
                          {s ? <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={block.id}>{r.runId}</StoryRunLink> : <RunLink pack={r.pack} stack={r.stack} runId={r.runId} />}
                          {r.stack !== run.stack ? <div className="small">{r.label}</div> : null}
                        </td>
                        <td className="n" data-measure="heldOut" data-flagged={line.diffs?.heldOut.flagged ? "true" : undefined}>
                          {s && s.ownTotal ? <div className="line-value">{s.ownPassed ?? 0}/{s.ownTotal}</div> : missing("held-out result")}
                          {line.diffs?.heldOut.rel != null ? <div className={`diff${line.diffs.heldOut.flagged ? " flagged" : ""}`} tabIndex={line.diffs.heldOut.flagged ? 0 : undefined} data-tip={line.diffs.heldOut.flagged ? GLOSSARY.compareDiff.what : undefined}>{signedPercent(line.diffs.heldOut.rel)}</div> : null}
                        </td>
                        <td className="bar-cell" data-measure="timeBar">
                          {s?.usage?.split ? <SplitBar split={s.usage.split} usage={s.usage} scaleSeconds={block.scaleSeconds} label={`${r.runId} story ${block.id}: ${duration(s.usage.split.wall)}`} hrefOf={conversationPartHref(r, s)} /> : missing("time breakdown")}
                        </td>
                        {COMPARE_MEASURES.filter((m) => m.key !== "heldOut").map((m) => cell(m.key, num(m.key), GLOSSARY[m.term].name.toLowerCase()))}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </>}
        </div>
      </>}
    </Section>
  );
}

export function RelatedRuns({ run, others }: { run: Row; others: Row[] }) {
  return (
    <Section term="relatedRuns" id="related" aside={<CombinationLink pack={run.pack} stack={run.stack} label={`all of ${run.label}`} />}>
      {others.length === 0 ? <p className="rp-empty">This is the combination's only run in this pack.</p> : (
        <RunSectionLists scope="run" items={others} runOf={(r) => r} className="rp-related" render={(r) => {
            const v = statusView(r);
            const rec = scoreOfRecord(r);
            return (
              <li key={r.runId} data-run={r.runId}>
                <span className={`s-${v.status}`} aria-hidden="true">{v.icon}</span>{" "}
                <RunLink pack={r.pack} stack={r.stack} runId={r.runId} />{" "}
                <span className={`status-word s-${v.status}`}>{v.status}</span>
                <span className="small"> · <MachineLink machine={r.machine} host={r.host} /> · {r.stories.length} {r.stories.length === 1 ? "story" : "stories"} recorded · </span>
                {rec.kind === "scored" ? <span className="small">score <b>{rec.passed}/{rec.total}</b></span>
                  : <span className="small" data-score={rec.reason} data-tip={GLOSSARY.noScore.what}>{rec.reason === "pending" ? `score ${PENDING}` : "no score"}</span>}
              </li>
            );
          }} />
      )}
    </Section>
  );
}
