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
      <div className="small" title="everything the model read: fresh input plus cache reads and writes">{short(u.readTokens)} read</div>
      {u.calls ? <div className="small">{short(u.calls)} calls</div> : null}
    </>
  );
}

/** Output tokens over the time the run's recorded stories took. */
export function SpeedCell({ row }: { row: Row }) {
  const u = row.usage;
  if (u.tokS === null) return <span className="wait">—</span>;
  return <div title="output tokens ÷ the time the stories took (the whole story: model, tools and all)">{Math.round(u.tokS)} tok/s</div>;
}

const flowsNow = (q: StorySquare | undefined) => (q && q.total ? `${q.passed}/${q.total}` : "—");

/** One line per recorded story: what it passed, what it cost, how fast the model ran. */
export function StoryUsageTable({ stories, squares }: { stories: Story[]; squares: StorySquare[] }) {
  if (stories.length === 0) return <div className="small">No stories recorded yet.</div>;
  return (
    <table className="usage">
      <thead>
        <tr>
          <th>Story</th><th title="Its hidden flows passing against the latest build, as the squares show">Flows now</th><th>Agent min</th><th>Calls</th><th>Out tokens</th><th title="everything the model read: fresh input plus cache reads and writes">Read tokens</th>
          <th title="the share of what it read that came from the prompt cache">Cached</th><th title="output tokens ÷ the time the story took">tok/s</th>
          <th title="the model alone, where the harness timed it">Decode tok/s</th><th title="the model alone, where the harness timed it">Prefill tok/s</th><th>Draft accepted</th>
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
