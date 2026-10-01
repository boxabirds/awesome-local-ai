// How this story run compares with every combination on this story, as two answers per combination: is it higher or
// lower quality, and is it faster or slower? A verdict in bold, then the plain numbers (this run first); the range on
// hover. Its own combination first (this run against its other runs), then the others, best quality first. Output
// tokens and tool calls are behind "detail". The rows and verdicts are acrossVerdicts'; this only lays them out.
import type { Row, State } from "../../../shared/types.ts";
import { acrossVerdicts, speedText, type VerdictRow } from "../../../shared/storyView.ts";
import type { Spread } from "../../../shared/stats.ts";
import { CombinationLink, StoryLink } from "../EntityLinks.tsx";
import { SHOW } from "../story/parts.tsx";
import { Missing, Section, Term } from "./bits.tsx";

const NONE = "—";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const rangeTip = (s: Spread | null, show: (v: number) => string, row: VerdictRow) =>
  s ? `${row.label}: median ${show(s.median)}, from ${show(s.min)} to ${show(s.max)}, over ${plural(s.n, "finished run")}.` : undefined;

function Figures({ mine, median, show }: { mine: number | null; median: number | null; show: (v: number) => string }) {
  return <span className="figures">{mine === null ? NONE : show(mine)} vs {median === null ? NONE : show(median)}</span>;
}

function Quality({ row }: { row: VerdictRow }) {
  const q = row.quality;
  return (
    <td data-measure="quality" tabIndex={q.spread ? 0 : undefined} data-tip={rangeTip(q.spread, SHOW.heldOut, row)}>
      {q.verdict ? <b className="verdict" data-verdict={q.verdict}>{q.verdict}</b> : null}
      <Figures mine={q.mine} median={q.median} show={SHOW.heldOut} />
    </td>
  );
}

function Speed({ row }: { row: VerdictRow }) {
  const t = row.speed;
  return (
    <td data-measure="speed" tabIndex={t.spread ? 0 : undefined} data-tip={rangeTip(t.spread, SHOW.minutes, row)}>
      {t.verdict ? <b className="verdict" data-verdict={t.verdict.kind}>{speedText(t.verdict)}</b> : null}
      <Figures mine={t.mine} median={t.median} show={SHOW.minutes} />
    </td>
  );
}

function Median({ s, show }: { s: Spread | null; show: (v: number) => string }) {
  if (!s) return <Missing why="No finished run of this combination recorded it for this story." />;
  return <span className="spread"><b>{show(s.median)}</b>{s.min !== s.max ? <span className="range">{show(s.min)}–{show(s.max)}</span> : null}</span>;
}

export function AcrossCombinations({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { rows, mine } = acrossVerdicts(run, state.rows, storyId);
  const aside = <StoryLink pack={run.pack} story={storyId}>all runs of this story</StoryLink>;
  const name = (row: VerdictRow) => (
    <th scope="row">
      {row.isThis ? <>this combination <span className="small">({row.label})</span></> : <CombinationLink pack={row.pack} stack={row.stack} label={row.label} />}
      <span className="runs-n">{row.isThis ? `${plural(row.n, "other run")}` : plural(row.n, "run")}</span>
    </th>
  );
  return (
    <Section term="acrossCombinations" id="across" aside={aside}>
      {rows.length === 0 ? <p className="rp-empty">No other finished run, of this combination or another, has recorded story {Number(storyId)} yet.</p> : <>
        <div className="table-scroll">
          <table className="rp-table verdicts" aria-label={`Story ${storyId}: this run against every combination`}>
            <thead>
              <tr>
                <th scope="col">Combination</th>
                <th scope="col"><Term id="acrossQuality" /> <span className="small">this run vs median</span></th>
                <th scope="col"><Term id="acrossSpeed" /> <span className="small">this run vs median</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stack} data-stack={row.stack} data-this={row.isThis ? "true" : undefined} className={row.isThis ? "is-this" : undefined}>
                  {name(row)}<Quality row={row} /><Speed row={row} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="across-detail" data-part="detail">
          <summary>detail: output tokens and tool calls</summary>
          <div className="table-scroll">
            <table className="rp-table verdicts" aria-label={`Story ${storyId}: output tokens and tool calls by combination`}>
              <thead>
                <tr><th scope="col">Combination</th><th scope="col" className="n"><Term id="outTokens" /> <span className="small">median, range</span></th><th scope="col" className="n"><Term id="calls" /> <span className="small">median, range</span></th></tr>
              </thead>
              <tbody>
                <tr data-row="this" aria-current="page">
                  <th scope="row">this story run <span className="run-id">{run.runId}</span></th>
                  <td className="n" data-measure="outTokens">{mine?.outTokens != null ? SHOW.outTokens(mine.outTokens) : <Missing why="Not recorded for this story run." />}</td>
                  <td className="n" data-measure="calls">{mine?.calls != null ? SHOW.calls(mine.calls) : <Missing why="Not recorded for this story run." />}</td>
                </tr>
                {rows.map((row) => (
                  <tr key={row.stack} data-stack={row.stack}>
                    {name(row)}
                    <td className="n" data-measure="outTokens"><Median s={row.outTokens} show={SHOW.outTokens} /></td>
                    <td className="n" data-measure="calls"><Median s={row.calls} show={SHOW.calls} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </>}
    </Section>
  );
}
