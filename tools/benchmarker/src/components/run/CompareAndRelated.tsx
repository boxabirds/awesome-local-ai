// This run beside another of the same combination, story by story; and the combination's other runs.
// Modest on purpose: the combination page has the full runs x stories matrix.
import { useState } from "react";
import type { Row } from "../../../shared/types.ts";
import { COMPARE_MEASURES, compareMany, PENDING, scoreOfRecord, signedPercent, statusView, type MeasureKey } from "../../../shared/runView.ts";
import { compareToken, parseCompareList, resolveCompareList, runKey, serializeCompareList } from "../../../shared/compareList.ts";
import { readRemember, readRemembered, writeRemember, writeRemembered } from "../../compareMemory.ts";
import { ComparePicker } from "./ComparePicker.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { pct, speed } from "./RunCost.tsx";
import { useAddressParam } from "../story/useAddressParam.ts";
import { RunSectionLists } from "../RunGroupHead.tsx";

const SHOW: Record<MeasureKey, (n: number) => string> = { minutes: duration, outTokens: short, calls: full, tokS: speed, heldOut: pct };

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
  const rows = compareMany(run, chosen);

  return (
    <Section term="compareRuns" id="compare">
      {candidates.length === 0 ? <p className="rp-empty">No other run in this pack and suite has recorded a story to compare with.</p> : <>
        <ComparePicker candidates={candidates} chosen={chosen} remember={remember} onRemember={onRemember}
          onAdd={(r) => setChosen([...chosen, r])} onRemove={(r) => setChosen(chosen.filter((c) => runKey(c) !== runKey(r)))} />
        {unknown.length ? <p className="small" data-unknown={unknown.join(",")}>The address names {unknown.join(", ")}, which {unknown.length === 1 ? "isn't" : "aren't"} a run in this pack and suite with a story recorded; {unknown.length === 1 ? "it is" : "they are"} left out.</p> : null}
        {chosen.length === 0 ? <p className="rp-empty">Choose a run to compare with.</p>
          : rows.length === 0 ? <p className="rp-empty">{chosen.length === 1 ? "Neither run has" : "None of these runs has"} recorded a story yet.</p> : <>
          <p className="small compare-key">
            Each cell: <b>{run.runId}</b> over {chosen.map((o, i) => <span key={runKey(o)}>{i ? ", " : ""}<RunLink pack={o.pack} stack={o.stack} runId={o.runId} /></span>)}; <span className="diff flagged">marked</span> where another run differs from {run.runId} by more than 10%.
          </p>
          <div className="table-scroll">
            <table className="rp-table compare" aria-label={`${run.runId} against ${chosen.map((o) => o.runId).join(", ")}`}>
              <thead>
                <tr>
                  <th>Story</th>
                  {COMPARE_MEASURES.map((m) => <th key={m.key} className="n"><Term id={m.term} /></th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-story={r.id}>
                    <td className="story-cell">
                      {r.id}. {r.title || `story ${r.id}`}
                      <div className="small">
                        {r.inA ? <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={r.id}>{run.runId}</StoryRunLink> : null}
                        {chosen.map((o, i) => r.inOthers[i] ? (
                          <span key={runKey(o)}>{r.inA || r.inOthers.slice(0, i).some(Boolean) ? " · " : null}<StoryRunLink pack={o.pack} stack={o.stack} runId={o.runId} story={r.id}>{o.runId}</StoryRunLink></span>
                        ) : null)}
                      </div>
                    </td>
                    {r.cells.map((c) => {
                      const measure = COMPARE_MEASURES.find((m) => m.key === c.key)!;
                      const what = GLOSSARY[measure.term].name.toLowerCase();
                      return (
                        <td key={c.key} className="n pair" data-measure={c.key} data-flagged={c.others.some((o) => o.flagged) ? "true" : undefined}>
                          <div className="pair-a">{c.a !== null ? SHOW[c.key](c.a) : <Missing why={r.inA ? `${run.runId} has no ${what} for this story.` : `${run.runId} hasn't recorded this story.`} />}</div>
                          {c.others.map((o, i) => (
                            <div key={runKey(chosen[i])} className="pair-other" data-run={chosen[i].runId}>
                              <div className="pair-b">
                                {chosen.length > 1 ? <span className="pair-tag small">{chosen[i].runId} </span> : null}
                                {o.b !== null ? SHOW[c.key](o.b) : <Missing why={r.inOthers[i] ? `${chosen[i].runId} has no figure for this story.` : `${chosen[i].runId} hasn't recorded this story.`} />}
                              </div>
                              {o.rel !== null ? <div className={`diff${o.flagged ? " flagged" : ""}`} tabIndex={o.flagged ? 0 : undefined} data-tip={o.flagged ? GLOSSARY.compareDiff.what : undefined}>{signedPercent(o.rel)}</div> : null}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
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
