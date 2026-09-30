import type { Row, Story, StorySquare } from "../../shared/types.ts";

const K = 1000;
const M = 1_000_000;
const SPEED_DECIMALS = 1;
const PERCENT = 100;

/** 55968 -> "56k", 6230043 -> "6.2M". */
export function short(n: number | null): string {
  if (n === null) return "—";
  if (n >= M) return `${(n / M).toFixed(1)}M`;
  if (n >= K) return `${Math.round(n / K)}k`;
  return String(n);
}

const full = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-GB"));
const speed = (n: number | null) => (n === null ? "—" : n.toFixed(SPEED_DECIMALS));

/** Output tokens over the run's recorded stories; input under it. */
export function TokensCell({ row }: { row: Row }) {
  const u = row.usage;
  if (u.outTokens === null) return <span className="wait">—</span>;
  return (
    <>
      <div>{short(u.outTokens)} out</div>
      <div className="small" data-tip="Input tokens: everything the model had to read to answer, summed over all its calls. On every call it re-reads the whole conversation so far (spec, code, tool output), mostly from its cache, so this grows with the number of calls. The bigger this is, the more work each story costs.">{short(u.readTokens)} in</div>
      {u.calls ? <div className="small">{short(u.calls)} calls</div> : null}
    </>
  );
}

/** Output tokens over the time the run's recorded stories took. */
export function SpeedCell({ row }: { row: Row }) {
  const u = row.usage;
  if (u.tokS === null) return <span className="wait">—</span>;
  return <div data-tip="output tokens ÷ the time the stories took (the whole story: model, tools and all)">{Math.round(u.tokS)} tok/s</div>;
}

const flowsNow = (q: StorySquare | undefined) => (q && q.total ? `${q.passed}/${q.total}` : "—");

/** One line per recorded story: what it passed, what it cost, how fast the model ran. */
export function StoryUsageTable({ stories, squares }: { stories: Story[]; squares: StorySquare[] }) {
  if (stories.length === 0) return <div className="small">No stories recorded yet.</div>;
  return (
    <table className="usage">
      <thead>
        <tr>
          <th>Story</th><th data-tip="This story's held-out tests passing against the run's latest build, as its square shows">Held-out passing (latest build)</th><th>Agent min</th><th>Calls</th><th>Out tokens</th><th data-tip="Input tokens: everything the model had to read to answer, summed over all its calls. On every call it re-reads the whole conversation so far (spec, code, tool output), mostly from its cache, so this grows with the number of calls. The bigger this is, the more work each story costs.">Input tokens</th>
          <th data-tip="The share of the input tokens served from the prompt cache rather than processed afresh.">Cached</th><th data-tip="output tokens ÷ the time the story took">tok/s</th>
          <th data-tip="the model alone, where the harness timed it">Decode tok/s</th><th data-tip="the model alone, where the harness timed it">Prefill tok/s</th><th>Draft accepted</th>
        </tr>
      </thead>
      <tbody>
        {stories.map((s) => {
          const u = s.usage;
          return (
            <tr key={s.id}>
              <td className="story-name" data-tip={s.title}><div className="clamp3">{s.id}. {s.title}</div></td>
              <td>{flowsNow(squares.find((q) => q.id === s.id))}</td>
              <td>{u?.agentSeconds != null ? Math.round(u.agentSeconds / 60) : "—"}</td>
              <td>{full(u?.calls ?? null)}</td>
              <td>{full(u?.outTokens ?? null)}</td>
              <td>{short(u?.readTokens ?? null)}</td>
              <td>{u?.readTokens && u.cacheRead != null ? `${Math.round((u.cacheRead / u.readTokens) * PERCENT)}%` : "—"}</td>
              <td>{speed(u?.tokS ?? null)}</td>
              <td>{speed(u?.decodeTokS ?? null)}</td>
              <td>{speed(u?.prefillTokS ?? null)}</td>
              <td>{u?.draftAcceptance != null ? `${Math.round(u.draftAcceptance * PERCENT)}%` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
