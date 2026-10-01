// This run beside another of the same combination, story by story; and the combination's other runs.
// Modest on purpose: the combination page has the full runs x stories matrix.
import type { Row } from "../../../shared/types.ts";
import { COMPARE_MEASURES, compareRuns, PENDING, scoreOfRecord, signedPercent, statusView, type MeasureKey } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { pct, speed } from "./RunCost.tsx";
import { useAddressParam } from "../story/useAddressParam.ts";

const SHOW: Record<MeasureKey, (n: number) => string> = { minutes: duration, outTokens: short, calls: full, tokS: speed, heldOut: pct };

/** The run compared with is in the address (?compare=v2-r4), so a reload or a shared link keeps it. With none there,
 * the first other run that has recorded a story; ?compare=none when the reader chose no run. */
const NONE = "none";

export function CompareRuns({ run, others, params }: { run: Row; others: Row[]; params?: Record<string, string> }) {
  const [param, setParam] = useAddressParam(params, "compare");
  const fallback = others.find((r) => r.stories.length)?.runId ?? "";
  const chosen = param === NONE ? "" : param ?? fallback;
  const setChosen = (id: string) => setParam(id === "" ? NONE : id);
  const other = others.find((r) => r.runId === chosen) ?? null;
  const unknown = chosen !== "" && !other;
  const rows = other ? compareRuns(run, other) : [];
  const selectId = "compare-with";
  const aside = others.length ? (
    <label className="compare-pick" htmlFor={selectId}>
      against{" "}
      <select id={selectId} value={other ? chosen : ""} onChange={(e) => setChosen(e.target.value)}>
        <option value="">choose a run…</option>
        {others.map((r) => <option key={r.runId} value={r.runId}>{r.runId} · {r.status}{r.stories.length ? ` · ${r.stories.length} recorded` : " · nothing recorded"}</option>)}
      </select>
    </label>
  ) : null;
  return (
    <Section term="compareRuns" id="compare" aside={aside}>
      {others.length === 0 ? <p className="rp-empty">This combination has no other run in this pack to compare with.</p>
        : unknown ? <p className="rp-empty" data-unknown={chosen}>The address names {chosen}, which isn't another run of this combination in this pack version. Choose a run to compare with.</p>
        : !other ? <p className="rp-empty">Choose a run to compare with.</p>
        : rows.length === 0 ? <p className="rp-empty">Neither run has recorded a story yet.</p> : <>
          <p className="small compare-key">
            Each cell: <b>{run.runId}</b> over <RunLink pack={other.pack} stack={other.stack} runId={other.runId} />; <span className="diff flagged">marked</span> where {run.runId} differs from {other.runId} by more than 10%.
          </p>
          <div className="table-scroll">
            <table className="rp-table compare" aria-label={`${run.runId} against ${other.runId}`}>
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
                        {r.inA && r.inB ? " · " : null}
                        {r.inB ? <StoryRunLink pack={other.pack} stack={other.stack} runId={other.runId} story={r.id}>{other.runId}</StoryRunLink> : null}
                      </div>
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.key} className="n pair" data-measure={c.key} data-flagged={c.flagged ? "true" : undefined}>
                        <div className="pair-a">{c.a !== null ? SHOW[c.key](c.a) : <Missing why={r.inA ? `${run.runId} has no ${GLOSSARY[COMPARE_MEASURES.find((m) => m.key === c.key)!.term].name.toLowerCase()} for this story.` : `${run.runId} hasn't recorded this story.`} />}</div>
                        <div className="pair-b">{c.b !== null ? SHOW[c.key](c.b) : <Missing why={r.inB ? `${other.runId} has no figure for this story.` : `${other.runId} hasn't recorded this story.`} />}</div>
                        {c.rel !== null ? <div className={`diff${c.flagged ? " flagged" : ""}`} tabIndex={c.flagged ? 0 : undefined} data-tip={c.flagged ? GLOSSARY.compareDiff.what : undefined}>{signedPercent(c.rel)}</div> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
    </Section>
  );
}

export function RelatedRuns({ run, others }: { run: Row; others: Row[] }) {
  return (
    <Section term="relatedRuns" id="related" aside={<CombinationLink pack={run.pack} stack={run.stack} label={`all of ${run.label}`} />}>
      {others.length === 0 ? <p className="rp-empty">This is the combination's only run in this pack.</p> : (
        <ul className="rp-related">
          {others.map((r) => {
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
          })}
        </ul>
      )}
    </Section>
  );
}
