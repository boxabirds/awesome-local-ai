// What the run cost: its totals, then one row per recorded story (what the old expanded row showed), each story
// a link to its story run.
import type { ReactNode } from "react";
import type { Row, Usage } from "../../../shared/types.ts";
import { interventionsOf, isCloud, runTotals, whyMissing, whyRunMissing } from "../../../shared/runView.ts";
import { InterventionMark } from "../RunMarks.tsx";
import type { TermId } from "../../../shared/glossary.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, NotApplicable, Section, Stat, Term, full } from "./bits.tsx";

const SPEED_DECIMALS = 1;
const PERCENT = 100;

export const speed = (n: number) => n.toFixed(SPEED_DECIMALS);
export const pct = (frac: number) => `${Math.round(frac * PERCENT)}%`;

/** The model's own speeds, on one small line under the cost: "engine speed: generation 31.2 tok/s · reading 980 tok/s". */
export function EngineSpeed({ decode, prefill, whyDecode, whyPrefill, cloud = false }: { decode: number | null; prefill: number | null; whyDecode: string; whyPrefill: string; cloud?: boolean }) {
  const show = (v: number | null, why: string) => (cloud ? <NotApplicable /> : v === null ? <Missing why={why} /> : `${speed(v)} tok/s`);
  return (
    <p className="small engine-speed" data-stat="engineSpeed">
      <Term id="engineSpeed" />: <Term id="decodeTokS">generation</Term> <span data-fact="decode">{show(decode, whyDecode)}</span>
      {" · "}<Term id="prefillTokS">reading</Term> <span data-fact="prefill">{show(prefill, whyPrefill)}</span>
    </p>
  );
}

export function RunCost({ run }: { run: Row }) {
  const t = runTotals(run);
  const or = (v: number | null, show: (n: number) => string, why: Parameters<typeof whyRunMissing>[1]) =>
    v === null ? <Missing why={whyRunMissing(run, why)} /> : show(v);
  return (
    <Section term="cost" id="cost" aside={<span className="small">over {t.stories} {t.stories === 1 ? "story" : "stories"}</span>}>
      <div className="stats">
        <Stat term="outTokens">{or(t.outTokens, short, "tokens")}</Stat>
        <Stat term="inputRead">{or(t.readTokens, short, "tokens")}</Stat>
        <Stat term="calls">{or(t.calls, full, "tokens")}</Stat>
        <Stat term="tokS">{or(t.tokS, speed, "speed")}</Stat>
        <Stat term="compactions">{or(t.compactions, String, "counter")}</Stat>
        <Stat term="nudges">{or(t.nudges, String, "counter")}</Stat>
      </div>
      <EngineSpeed decode={t.decodeTokS} prefill={t.prefillTokS} whyDecode={whyRunMissing(run, "model-speed")} whyPrefill={whyRunMissing(run, "model-speed")} cloud={isCloud(run)} />
      <StoryCostTable run={run} />
    </Section>
  );
}

type Col = { term: TermId; label?: string; cell: (u: Usage, cloud: boolean) => ReactNode };

/** A usage figure, or Missing with why. */
const num = (v: number | null | undefined, show: (n: number) => string, u: Usage, what: Parameters<typeof whyMissing>[1]) =>
  v == null ? <Missing why={whyMissing(u, what)} /> : show(v);

const COLS: Col[] = [
  { term: "agentTime", cell: (u) => num(u.agentSeconds, duration, u, "story") },
  { term: "calls", cell: (u) => num(u.calls, full, u, "story") },
  { term: "outTokens", cell: (u) => num(u.outTokens, full, u, "story") },
  { term: "inputRead", cell: (u) => num(u.readTokens, short, u, "story") },
  { term: "cached", cell: (u) => (u.readTokens && u.cacheRead != null ? pct(u.cacheRead / u.readTokens) : <Missing why={whyMissing(u, "cached")} />) },
  { term: "tokS", cell: (u) => num(u.tokS, speed, u, "story") },
  { term: "decodeTokS", label: "generation", cell: (u, cloud) => (cloud ? <NotApplicable /> : num(u.decodeTokS, speed, u, "decode")) },
  { term: "prefillTokS", label: "reading", cell: (u, cloud) => (cloud ? <NotApplicable /> : num(u.prefillTokS, speed, u, "prefill")) },
  { term: "draftAcceptance", label: "Draft", cell: (u, cloud) => (cloud ? <NotApplicable /> : num(u.draftAcceptance, pct, u, "draft")) },
];  // compactions and nudges per story are on each story run's page, and summed in the totals above

function StoryCostTable({ run }: { run: Row }) {
  if (run.stories.length === 0) return <p className="rp-empty">No story recorded yet{run.status === "queued" ? ": the run is queued" : ""}.</p>;
  return (
    <div className="table-scroll">
      <table className="rp-table story-cost" aria-label="Cost per story">
        <thead>
          <tr>
            <th>Story</th>
            <th><Term id="storyHeldOut">Held-out</Term></th>
            {COLS.map((c) => <th key={c.term} className="n"><Term id={c.term}>{c.label}</Term></th>)}
          </tr>
        </thead>
        <tbody>
          {run.stories.map((s) => {
            const q = run.storiesWorking.squares.find((x) => x.id === s.id);
            return (
              <tr key={s.id} data-story={s.id}>
                <td className="story-cell"><StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={s.id}>{s.id}. {s.title || `story ${s.id}`}</StoryRunLink> <InterventionMark list={interventionsOf(run, s.id)} compact /></td>
                <td>{q?.total ? <span className={`held q-text-${q.state}`}>{q.passed}/{q.total}</span> : <Missing why="No held-out result for this story." />}</td>
                {s.usage
                  ? COLS.map((c) => <td key={c.term} className="n">{c.cell(s.usage!, isCloud(run))}</td>)
                  : <td colSpan={COLS.length} className="no-usage"><Missing why={whyMissing(null, "story")} /> no usage recorded for this story</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
