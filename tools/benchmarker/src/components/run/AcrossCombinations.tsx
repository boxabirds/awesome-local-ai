// How every combination fares on this story: one row per combination that has recorded it, in the story page's order,
// each with the story page's own median and range over its valid finished runs; this story run's own figures on the
// first row, and its agent time marked on every bar, so it can be placed against each combination's typical run.
// The rows, the scale and every missing figure's why come from acrossCombinations; this only lays them out.
import type { Row, State } from "../../../shared/types.ts";
import { acrossCombinations, acrossNoMedian, STORY_MEASURES, type AcrossRow, type SummaryKey } from "../../../shared/storyView.ts";
import { againstAbsent } from "../../../shared/runView.ts";
import type { Spread } from "../../../shared/stats.ts";
import { CombinationLink, StoryLink } from "../EntityLinks.tsx";
import { SHOW, termName, whyNoValue } from "../story/parts.tsx";
import { Missing, Section, Term } from "./bits.tsx";

const PERCENT = 100;
/** Quality before cost, as in "Against the combination": held-out first, then what it cost. */
const ORDER: SummaryKey[] = ["heldOut", "minutes", "outTokens", "calls"];
const MEASURES = ORDER.map((k) => STORY_MEASURES.find((m) => m.key === k)!);
/** Combination, runs, and the bar beside agent time: the columns that aren't a measure. */
const OTHER_COLS = 3;
const share = (v: number, scale: number) => `${(v / scale) * PERCENT}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const measureName = (k: SummaryKey) => termName(MEASURES.find((m) => m.key === k)!.term).toLowerCase();

/** A median with its range under it; the measure's own n where fewer runs had it than recorded the story. */
function Median({ s, k, n }: { s: Spread; k: SummaryKey; n: number }) {
  return (
    <span className="spread">
      <b className="median">{SHOW[k](s.median)}</b>
      {s.min !== s.max ? <span className="range">{SHOW[k](s.min)}–{SHOW[k](s.max)}</span> : null}
      {s.n !== n ? <span className="n-runs">n={s.n}</span> : null}
    </span>
  );
}

/** A combination's time bar: filled to its median, a line from its lowest to its highest, and this story run's own
 * time marked across it. This story run's own bar (`own`) is filled to its time, in the colour of the mark. */
function TimeBar({ fill, range, mark, own, scale, label }: { fill: number | null; range?: Spread | null; mark?: number | null; own?: boolean; scale: number; label: string }) {
  if (fill === null) return null;
  return (
    <span className="across-bar" role="img" aria-label={label}>
      <span className={own ? "med own" : "med"} style={{ width: share(fill, scale) }} />
      {range && range.min !== range.max ? <span className="whisker" style={{ left: share(range.min, scale), width: share(range.max - range.min, scale) }} /> : null}
      {mark != null ? <span className="mine-mark" style={{ left: share(mark, scale) }} /> : null}
    </span>
  );
}

/** How many runs the row's medians are over, and the runs that recorded the story but are in no median. */
function Runs({ row }: { row: AcrossRow }) {
  const head = row.state === "measured" ? <b>n={row.n}</b>
    : row.state === "noValid" ? <span className="no-median">no valid runs yet</span>
    : row.state === "unfinished" ? <span className="no-median">no finished run yet</span>
    : <span className="no-median">not recorded yet</span>;
  return (
    <td className="runs" data-col="runs">
      {head}
      {row.unfinished.map((u) => <span key={u.status} className="small aside-n" data-unfinished={u.status}>+{u.count} {u.status}</span>)}
      {row.invalid ? <span className="small aside-n" data-invalid-runs>{row.invalid} invalid, left out</span> : null}
    </td>
  );
}

export function AcrossCombinations({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { rows, mine, story, scaleMinutes, withoutRecord } = acrossCombinations(run, state.rows, storyId);
  const notRecorded = againstAbsent(run, storyId).why || "This story run has no record yet.";
  const aside = <StoryLink pack={run.pack} story={storyId}>all runs of this story</StoryLink>;
  return (
    <Section term="acrossCombinations" id="across" aside={aside}>
      <div className="table-scroll">
        <table className="rp-table across" aria-label={`Story ${storyId} across combinations`}>
          <thead>
            <tr>
              <th scope="col">Combination</th>
              <th scope="col"><Term id="acrossRuns" /></th>
              {MEASURES.map((m) => (
                <th key={m.key} scope="col" className={m.key === "minutes" ? "m-minutes" : "n"} colSpan={m.key === "minutes" ? 2 : 1} data-measure={m.key}>
                  <Term id={m.term} /> <span className="th-sub"><Term id="storyCombinationMedian">median, range</Term></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="is-this" data-row="this" aria-current="page">
              <th scope="row"><span className="this-mark">this story run</span> <span className="run-id">{run.runId}</span></th>
              <td className="runs" data-col="runs">{story ? null : <span className="no-median">not recorded yet</span>}</td>
              {MEASURES.map((m) => {
                const v = mine?.[m.key] ?? null;
                const cell = (
                  <td key={m.key} className="n" data-measure={m.key}>
                    {v === null ? <Missing why={story ? whyNoValue(story, m.key) : notRecorded} />
                      : <><b>{SHOW[m.key](v)}</b>{m.key === "heldOut" ? <span className="range">{story!.ownPassed ?? 0}/{story!.ownTotal}</span> : null}</>}
                  </td>
                );
                return m.key !== "minutes" ? cell : [
                  <td key="bar" className="bar-col"><TimeBar fill={v} own scale={scaleMinutes} label={`This story run: ${v === null ? "" : SHOW.minutes(v)}`} /></td>,
                  cell,
                ];
              })}
            </tr>
            {rows.map((row) => (
              <tr key={row.stack} data-stack={row.stack} data-state={row.state} data-this={row.isThis ? "true" : undefined}>
                <th scope="row">
                  <CombinationLink pack={row.pack} stack={row.stack} label={row.label} />
                  {row.isThis ? <span className="this-combo">this run's combination</span> : null}
                </th>
                <Runs row={row} />
                {MEASURES.map((m) => {
                  const s = row.summary[m.key].spread;
                  const cell = (
                    <td key={m.key} className="n" data-measure={m.key}>
                      {s ? <Median s={s} k={m.key} n={row.n} /> : <Missing why={acrossNoMedian(row, storyId, measureName(m.key))} />}
                    </td>
                  );
                  return m.key !== "minutes" ? cell : [
                    <td key="bar" className="bar-col">
                      <TimeBar fill={s?.median ?? null} range={s} mark={mine?.minutes ?? null} scale={scaleMinutes}
                        label={s ? `${row.label}: median ${SHOW.minutes(s.median)}, from ${SHOW.minutes(s.min)} to ${SHOW.minutes(s.max)}` : ""} />
                    </td>,
                    cell,
                  ];
                })}
              </tr>
            ))}
            {withoutRecord ? (
              <tr className="without-record" data-without-record={withoutRecord}>
                <td colSpan={OTHER_COLS + MEASURES.length}>
                  {plural(withoutRecord, "other combination has", "other combinations have")} no record of story {storyId} yet; <StoryLink pack={run.pack} story={storyId}>the story's page</StoryLink> says where each stands.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="small across-key">
        <span className="across-bar key" aria-hidden="true"><span className="med" /></span> median agent time, all bars on one scale
        {" · "}<span className="across-bar key" aria-hidden="true"><span className="whisker" /></span> lowest to highest
        {mine?.minutes != null ? <>{" · "}<span className="across-bar key mark" aria-hidden="true"><span className="mine-mark" /></span> this story run ({SHOW.minutes(mine.minutes)})</> : null}
        . Medians are over each combination's valid finished runs; this story run is in its own combination's when it is one of them.
      </p>
    </Section>
  );
}
