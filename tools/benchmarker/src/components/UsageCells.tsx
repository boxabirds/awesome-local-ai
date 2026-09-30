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
      <div className="small">{short(u.inTokens)} in</div>
    </>
  );
}

/** Decode speed over the run's recorded stories (tokens over seconds); prefill under it. */
export function SpeedCell({ row }: { row: Row }) {
  const u = row.usage;
  if (u.decodeTokS === null) {
    // The harness times the model from llama.cpp's server log, or through its metering proxy when a run
    // turns that on; cloud models and other unmetered servers have no timing to show.
    return <span className="wait" title="The model wasn't timed on this run: a cloud model, or a server the harness didn't meter">{u.outTokens === null ? "—" : "not timed"}</span>;
  }
  return (
    <>
      <div title="decode: output tokens per second of generation">{Math.round(u.decodeTokS)} tok/s</div>
      {u.prefillTokS !== null ? <div className="small" title="prefill: input tokens per second of reading">prefill {Math.round(u.prefillTokS)}/s</div> : null}
    </>
  );
}

const flowsNow = (q: StorySquare | undefined) => (q && q.total ? `${q.passed}/${q.total}` : "—");

/** One line per recorded story: what it passed, what it cost, how fast the model ran. */
export function StoryUsageTable({ stories, squares }: { stories: Story[]; squares: StorySquare[] }) {
  if (stories.length === 0) return <div className="small">No stories recorded yet.</div>;
  return (
    <table className="usage">
      <thead>
        <tr>
          <th>Story</th><th title="Its hidden flows passing against the latest build, as the squares show">Flows now</th><th>Agent min</th><th>Calls</th><th>Out tokens</th><th>In tokens</th>
          <th>Cache read</th><th>Decode tok/s</th><th>Prefill tok/s</th><th>Draft accepted</th>
        </tr>
      </thead>
      <tbody>
        {stories.map((s) => {
          const u = s.usage;
          return (
            <tr key={s.id}>
              <td title={s.title}>{s.id}. {s.title}</td>
              <td>{flowsNow(squares.find((q) => q.id === s.id))}</td>
              <td>{u?.agentSeconds != null ? Math.round(u.agentSeconds / 60) : "—"}</td>
              <td>{full(u?.calls ?? null)}</td>
              <td>{full(u?.outTokens ?? null)}</td>
              <td>{full(u?.inTokens ?? null)}</td>
              <td>{short(u?.cacheRead ?? null)}</td>
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
