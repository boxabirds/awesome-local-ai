import type { Row, TimeSplit, Usage } from "../../shared/types.ts";
import { short } from "./UsageCells.tsx";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;

type Seg = keyof Omit<TimeSplit, "wall">;

/** The parts of a story's time, in the order drawn, with what each is. */
const SEGMENTS: { seg: Seg; name: string; what: string }[] = [
  { seg: "prefill", name: "Prefill", what: "the model reading its input (including re-reading after a compaction or a resumed session)" },
  { seg: "decode", name: "Generation", what: "the model writing its output" },
  { seg: "modelUnsplit", name: "Model, not split", what: "a model whose time wasn't split into reading and writing (a cloud model), together with the agent's own time" },
  { seg: "compaction", name: "Compaction", what: "the model summarising its own conversation to make room" },
  { seg: "tools", name: "Tools", what: "commands the agent ran and waited on: builds, tests, file edits" },
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
    case "tools": return `Tools ${m}: commands and tests over ${u.calls ?? "?"} calls`;
    case "other": return `Other ${m}: the agent's own overhead`;
  }
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
            <span className="bar-label"><span className="stack-label">{r.label}</span> <b>{r.runId}</b></span>
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
