// "Now" as one card per machine, read top to bottom as machine > run > story: the machine (its state and queue), the run
// it is on (its combination, its place in its series), and that run's stories (the one being worked on, and every
// story's held-out result). Each name is a link to its own page, once. A machine that only runs the reference (the
// yardstick, not a stack under test) has a card only while it is working, and is named in a line underneath when not.
import type { Row } from "../../../shared/types.ts";
import type { NowLine } from "../../../shared/overviewView.ts";
import { seriesOf, span } from "../../../shared/dashboardView.ts";
import { storyResults } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { machineHref, storyRunHref } from "../../../shared/routes.ts";
import { SILENT_MINUTES } from "../../../shared/overviewView.ts";
import { duration } from "../../format.ts";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { QueueCount } from "../machine/NowSummary.tsx";
import { squareClass } from "../run/HeldOutAndJobs.tsx";
import { SeriesBar } from "./SeriesBar.tsx";

const STATE_WORD: Record<NowLine["state"], string> = { running: "running", queuedOnly: "waiting", idle: "idle", unreachable: "unreachable" };
const STATE_TIP: Record<NowLine["state"], string | undefined> = {
  running: undefined, queuedOnly: GLOSSARY.queuedOnly.what, idle: GLOSSARY.machineIdle.what, unreachable: GLOSSARY.machineUnreachable.what,
};
const SECONDS_PER_MINUTE = 60;

/** Every story in scope as a numbered square, each a link to that story's run; the one being worked on is marked. */
function Strip({ run, current }: { run: Row & { pack: string }; current: string | null }) {
  return (
    <span className="card-strip">
      {storyResults(run).map((r) => {
        const here = r.id === current;
        return (
          <a key={r.id} className="card-sq" data-story={r.id} aria-current={here ? "true" : undefined} href={storyRunHref(run.pack, run.stack, run.runId, r.id)} data-tip={r.tip} aria-label={r.tip}>
            <span className={squareClass(r)} data-state={r.state} />
            <span className="card-sq-no">{Number(r.id)}</span>
          </a>
        );
      })}
    </span>
  );
}

export function MachineCards({ lines, rows, now }: { lines: NowLine[]; rows: Row[]; now: number }) {
  const series = seriesOf(rows);
  // A reference machine earns a card by working; otherwise it is a name in a line, so the cards are the machines
  // under test.
  const shown = lines.filter((l) => !l.referenceOnly || l.state === "running");
  const resting = lines.filter((l) => l.referenceOnly && l.state !== "running");
  return (
    <section className="ov-section now" data-section="now" aria-labelledby="h-now">
      <h2 id="h-now"><span className="term" data-tip={GLOSSARY.now.what}>{GLOSSARY.now.name}</span></h2>
      {lines.length === 0 ? <p className="empty-note">No machines: none answered, and none is in the list.</p> : (
        <div className="cards">
          {shown.map((l) => {
            const run = l.run?.pack ? rows.find((r) => r.pack === l.run!.pack && r.stack === l.run!.stack && r.runId === l.run!.runId) ?? null : null;
            const s = run ? series.find((x) => x.stack === run.stack && x.runs.some((r) => r.runId === run.runId)) : null;
            const place = s && run ? s.runs.findIndex((r) => r.runId === run.runId) + 1 : 0;
            return (
              <article key={l.machine} className="machine-card" data-machine={l.machine} data-state={l.state}>
                <div className="card-head">
                  <MachineLink machine={l.machine} />
                  <span className={`card-state state-${l.state}`} data-tip={STATE_TIP[l.state]}>{STATE_WORD[l.state]}</span>
                </div>
                <div className="card-queue">
                  <a className="entity" href={machineHref(l.machine)}><QueueCount line={l} /></a>
                </div>
                {run && l.run?.pack ? (
                  <section className="card-level" data-level="run" aria-label="Run">
                    <h3 className="card-label">Run</h3>
                    <div className="card-line"><CombinationLink pack={run.pack} stack={run.stack} label={l.run.label} /> <RunLink pack={run.pack} stack={run.stack} runId={run.runId} /></div>
                    {s ? (
                      <div className="card-series">
                        <SeriesBar series={s} pack={run.pack} />
                        <span className="small">run {place} of {s.size} in its series</span>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {run && l.run?.pack ? (
                  <section className="card-level" data-level="story" aria-label="Story">
                    <h3 className="card-label"><span className="term" data-tip={GLOSSARY.heldOut.what}>Stories</span></h3>
                    <div className="card-line card-story">
                      {l.story === null ? <span className="small">starting</span> : <>
                        <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={l.story}>{Number(l.story)}{l.storyTitle ? `. ${l.storyTitle}` : ""}</StoryRunLink>
                        {l.finishing ? <span className="small"> (finishing: gates and scoring)</span> : null}
                        {l.minutes !== null ? <span className="small now-min" data-tip={GLOSSARY.storyMinutes.what}> · {Math.round(l.minutes)} min on this story</span> : null}
                      </>}
                      {l.silent !== null && l.silent >= SILENT_MINUTES ? <span className="now-stuck" data-tip={GLOSSARY.machineSilent.what}> ⚠ no activity for {duration(l.silent * SECONDS_PER_MINUTE)}</span> : null}
                    </div>
                    <Strip run={run as Row & { pack: string }} current={l.story} />
                  </section>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {resting.length ? (
        <p className="small now-reference">
          {resting.map((l, i) => <span key={l.machine}>{i ? ", " : ""}<MachineLink machine={l.machine} /> {STATE_WORD[l.state]}</span>)}
          <span data-tip={GLOSSARY.referenceMachine.what}> · runs the reference only</span>
        </p>
      ) : null}
    </section>
  );
}
