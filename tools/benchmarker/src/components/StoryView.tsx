import { useState } from "react";
import type { Row, Usage } from "../../shared/types.ts";
import { short } from "./UsageCells.tsx";

const SAVED_KEY = "benchmarker:story-view:v1";
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;

interface Saved { story?: string; comparison?: string }

function load(): Saved {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Saved; } catch { return {}; }
}
function save(s: Saved) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(s)); } catch { /* not remembered */ }
}

const jobKey = (r: Row) => `${r.stack}\u0000${r.runId}`;

/** The numbers compared across jobs: how each is read from a story's usage, and shown. */
const MEASURES: { cls: string; head: string; title: string; value: (u: Usage) => number | null; show: (v: number) => string }[] = [
  { cls: "minutes", head: "Agent min", title: "time the story took", value: (u) => u.agentSeconds, show: (v) => String(Math.round(v / SECONDS_PER_MINUTE)) },
  { cls: "calls", head: "Calls", title: "tool calls", value: (u) => u.calls, show: (v) => String(v) },
  { cls: "out", head: "Out tokens", title: "output tokens", value: (u) => u.outTokens, show: short },
  { cls: "read", head: "Read tokens", title: "everything the model read: input plus cache reads and writes", value: (u) => u.readTokens, show: short },
  { cls: "toks", head: "tok/s", title: "output tokens over the story's time", value: (u) => u.tokS, show: (v) => v.toFixed(1) },
  { cls: "decode", head: "Decode tok/s", title: "the model alone, where the harness timed it", value: (u) => u.decodeTokS, show: (v) => v.toFixed(1) },
  { cls: "compactions", head: "Compactions", title: "times the context was compacted", value: (u) => u.compactions, show: (v) => String(v) },
  { cls: "nudges", head: "Nudges", title: "times the harness nudged the agent to carry on", value: (u) => u.nudges, show: (v) => String(v) },
];

/** Every story in the jobs shown, by id, with a title. */
function storiesOf(rows: Row[]): { id: string; title: string }[] {
  const titles = new Map<string, string>();
  for (const r of rows) {
    for (const s of r.stories) if (s.title && !titles.has(s.id)) titles.set(s.id, s.title);
    for (const q of r.storiesWorking.squares) if (!titles.has(q.id)) titles.set(q.id, "");
  }
  return [...titles.entries()].map(([id, title]) => ({ id, title })).toSorted((a, b) => Number(a.id) - Number(b.id));
}

/** The story view: pick a story; every job's numbers for it side by side; one job as the comparison. */
export function StoryView({ rows, hidden = [] }: { rows: Row[]; hidden?: string[] }) {
  const [saved, setSaved] = useState<Saved>(load);
  const [selected, setSelected] = useState<string | null>(null);
  const stories = storiesOf(rows);
  const story = stories.find((s) => s.id === saved.story) ?? stories[0];
  const update = (next: Saved) => { setSaved(next); save(next); };
  if (!story) return <p className="empty">No stories for this pack, version and status.</p>;

  const jobs = rows
    .map((r) => ({ r, s: r.stories.find((x) => x.id === story.id), q: r.storiesWorking.squares.find((x) => x.id === story.id) }))
    .filter(({ s, q }) => s?.usage || (q && q.state !== "unbuilt"));
  const base = jobs.find(({ r }) => jobKey(r) === saved.comparison);
  const cell = (u: Usage | null | undefined, m: (typeof MEASURES)[number], isBase: boolean) => {
    const v = u ? m.value(u) : null;
    if (v === null) return "—";
    const b = base && !isBase && base.s?.usage ? m.value(base.s.usage) : null;
    // A percentage of 0 or of nothing means nothing: then the job's own number shows.
    return b ? `${Math.round((v / b) * PERCENT)}%` : m.show(v);
  };

  return (
    <div className="story-view">
      <nav className="story-list" aria-label="Stories">
        {stories.map((s) => (
          <button key={s.id} type="button" className={s.id === story.id ? "on" : undefined} onClick={() => update({ ...saved, story: s.id })}>
            <span className="clamp3">{s.id}. {s.title || `story ${s.id}`}</span>
          </button>
        ))}
      </nav>
      <section className="story-jobs">
        <h2>
          <span>Story {story.id}: {story.title}</span>
          <span className="toolbar">
            <button type="button" disabled={selected === null} onClick={() => selected && update({ ...saved, comparison: selected })}>Set as comparison job</button>
            <button type="button" disabled={!saved.comparison} onClick={() => update({ ...saved, comparison: undefined })}>Clear comparison</button>
          </span>
        </h2>
        {hidden.length ? <div className="small compare-note">Jobs that are {hidden.join(", ")} are hidden by the status filter above.</div> : null}
        {base ? <div className="small compare-note">Numbers are % of <b>{base.r.label} {base.r.runId}</b> ({base.r.machine}), shown in full on its row; where its number is 0 or missing, each job shows its own.</div> : null}
        <table aria-label={`Story ${story.id} by job`} className="by-job">
          <thead>
            <tr>
              <th>Job</th><th title="this story's held-out tests passing against the job's latest build">Held-out passing (latest build)</th>
              {MEASURES.map((m) => <th key={m.cls} title={m.title}>{m.head}</th>)}
            </tr>
          </thead>
          <tbody>
            {jobs.map(({ r, s, q }) => {
              const key = jobKey(r), isBase = base !== undefined && jobKey(base.r) === key;
              return (
                <tr key={key} data-stack={r.stack} data-run={r.runId} aria-selected={selected === key}
                    data-comparison={isBase ? "true" : undefined} onClick={() => setSelected(selected === key ? null : key)}>
                  <td><div className="stack-label">{r.label}</div><div className="run">{r.runId}</div><div className="small">{r.machine}</div></td>
                  <td>{q && q.total ? `${q.passed}/${q.total}` : "—"}</td>
                  {MEASURES.map((m) => <td key={m.cls} className={m.cls}>{cell(s?.usage, m, isBase)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {jobs.length === 0 ? <p className="empty">No job has built this story yet.</p> : null}
      </section>
    </div>
  );
}
