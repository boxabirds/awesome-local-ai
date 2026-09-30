import type { Row, TimeSplit, Usage } from "../../shared/types.ts";
import { short } from "./UsageCells.tsx";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;

type Seg = keyof Omit<TimeSplit, "wall" | "toolsByKind" | "check">;

/** The parts of a story's time, in the order drawn, with what each is. */
const SEGMENTS: { seg: Seg; name: string; what: string }[] = [
  { seg: "prefill", name: "Prefill", what: "the model reading its input (including re-reading after a compaction or a resumed session)" },
  { seg: "decode", name: "Generation", what: "the model writing its output" },
  { seg: "modelUnsplit", name: "Model, not split", what: "a model whose time wasn't split into reading and writing (a cloud model), together with the agent's own time" },
  { seg: "compaction", name: "Compaction", what: "the model summarising its own conversation to make room" },
  { seg: "tools", name: "Tools", what: "the agent waiting on its own tool calls: its test runs (npm run test, vitest, playwright), builds, file reads and edits, and any other command (dev servers, scripts)" },
  { seg: "betweenSessions", name: "Between sessions", what: "the harness starting the agent's next session after one ended: it waits a minute before resuming an agent whose session ended in an error, and nudges one that stopped without committing" },
  { seg: "other", name: "Other", what: "the agent's own overhead between steps" },
];

const min = (s: number) => Math.round(s / SECONDS_PER_MINUTE);

function tip(seg: Seg, s: number, u: Usage): string {
  const m = `${min(s)} min`;
  switch (seg) {
    case "prefill": return `Prefill ${m}: ${short(u.prefillTokens)} fresh input tokens at ${u.prefillTokS?.toFixed(0) ?? "?"} tok/s`;
    case "decode": return `Generation ${m}: ${short(u.decodeTokens)} tokens at ${u.decodeTokS?.toFixed(0) ?? "?"} tok/s`;
    case "modelUnsplit": return `Model and agent ${m}: not split into reading and writing (a cloud model, or a run not timed)`;
    case "compaction": return `Compaction ${m}, over ${u.compactions ?? "?"} compactions`;
    case "tools": return `Tools ${m} over ${u.calls ?? "?"} calls: ${toolKinds(u.split?.toolsByKind ?? {})}`;
    case "betweenSessions": return `Between sessions ${m}: the harness restarting the agent after its session ended (${u.nudges ?? 0} nudges)`;
    case "other": return `Other ${m}: the agent's own overhead`;
  }
}

const TEST_KINDS = new Set(["unit", "e2e", "component", "integration", "test"]);
const KIND_NAME: Record<string, string> = { e2e: "end-to-end", unit: "unit", component: "component", integration: "integration", build: "builds", read: "reading files", edit: "editing files", write: "writing files", bash: "other commands" };
const tenths = (s: number) => (s / SECONDS_PER_MINUTE).toFixed(1);

/** "the agent's tests 5.4 min (unit 3.5, end-to-end 1.9), builds 0.4, other commands 13.6": biggest first. */
function toolKinds(kinds: Record<string, number>): string {
  const tests = Object.entries(kinds).filter(([k, v]) => TEST_KINDS.has(k) && v > 0).toSorted((a, b) => b[1] - a[1]);
  const rest = Object.entries(kinds).filter(([k, v]) => !TEST_KINDS.has(k) && v >= SECONDS_PER_MINUTE / 10).toSorted((a, b) => b[1] - a[1]);
  const parts: [number, string][] = rest.map(([k, v]) => [v, `${KIND_NAME[k] ?? k} ${tenths(v)}`]);
  const t = tests.reduce((a, [, v]) => a + v, 0);
  if (t > 0) parts.push([t, `the agent's tests ${tenths(t)} (${tests.map(([k, v]) => `${KIND_NAME[k] ?? k} ${tenths(v)}`).join(", ")})`]);
  return parts.toSorted((a, b) => b[0] - a[0]).map(([, s]) => s).join(", ") + " min";
}

/** A split that failed its own checks is flagged with why; one recorded before there were checks says so. */
function CheckMark({ check }: { check: TimeSplit["check"] }) {
  if (check.status === "ok") return null;
  if (check.status === "unchecked") {
    return <span className="check-unchecked" tabIndex={0} data-tip="Unchecked: recorded before the harness checked its accounting (or a cloud model, whose calls aren't logged), so these parts weren't verified to add up">unchecked</span>;
  }
  return <span className="check-flag" tabIndex={0} role="img" aria-label="accounting check failed" data-tip={`This split failed its checks, so treat its parts with care: ${check.problems.join("; ")}`}>⚠</span>;
}

/** A bar per job for one story, all on one minutes scale, coloured by where the time went. */
export function TimeBars({ storyId, jobs }: { storyId: string; jobs: { r: Row; u: Usage | null | undefined }[] }) {
  const withSplit = jobs.filter((j) => j.u?.split);
  const max = Math.max(1, ...withSplit.map((j) => j.u!.split!.wall));
  if (withSplit.length === 0) return null;
  return (
    <figure className="time-bars" aria-label={`Where story ${storyId}'s time went, by job`}>
      <figcaption>
        <b>Where the time went</b>
        {SEGMENTS.map((s) => <span key={s.seg} className="legend" data-tip={`${s.name}: ${s.what}`}><i className={`seg-${s.seg}`} />{s.name}</span>)}
      </figcaption>
      {withSplit.map(({ r, u }) => {
        const sp = u!.split!;
        return (
          <div className="bar-row" key={`${r.stack}:${r.runId}`} data-job={`${r.stack}|${r.runId}`}>
            <span className="bar-label">
              <span className="bar-machine">{r.machine}</span>
              <span className="stack-label">{r.label}</span> <b>{r.runId}</b>
              <CheckMark check={sp.check} />
            </span>
            <span className="bar-track">
              <span className="bar" style={{ width: `${(sp.wall / max) * PERCENT}%` }}>
                {SEGMENTS.filter((s) => sp[s.seg] > 0).map((s) => (
                  <span key={s.seg} data-seg={s.seg} className={`seg seg-${s.seg}`} style={{ width: `${(sp[s.seg] / sp.wall) * PERCENT}%` }} data-tip={tip(s.seg, sp[s.seg], u!)} />
                ))}
              </span>
            </span>
            <span className="bar-total num">{min(sp.wall)} min</span>
          </div>
        );
      })}
    </figure>
  );
}
