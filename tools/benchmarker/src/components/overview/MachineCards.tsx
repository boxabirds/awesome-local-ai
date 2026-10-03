// "Now" as one card per machine: its state, the run and story it is on, the held-out strip of that run, where the run
// sits in its series, and its queue with how long the work will take (measured from the stack's finished runs).
import type { Row } from "../../../shared/types.ts";
import type { NowLine } from "../../../shared/overviewView.ts";
import { queueDrain, seriesOf, span } from "../../../shared/dashboardView.ts";
import { storyResults } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { MachineLink } from "../EntityLinks.tsx";
import { NowSummary, QueueCount } from "../machine/NowSummary.tsx";
import { squareClass } from "../run/HeldOutAndJobs.tsx";
import { SeriesBar } from "./SeriesBar.tsx";

const STATE_WORD: Record<NowLine["state"], string> = { running: "running", queuedOnly: "waiting", idle: "idle", unreachable: "unreachable" };

function Strip({ run }: { run: Row }) {
  return (
    <span className="card-strip" aria-label="Held-out result of each story in scope">
      {storyResults(run).map((r) => <span key={r.id} className={squareClass(r)} data-state={r.state} data-tip={r.tip} />)}
    </span>
  );
}

export function MachineCards({ lines, rows, now }: { lines: NowLine[]; rows: Row[]; now: number }) {
  const series = seriesOf(rows);
  return (
    <section className="ov-section now" data-section="now" aria-labelledby="h-now">
      <h2 id="h-now"><span className="term" data-tip={GLOSSARY.now.what}>{GLOSSARY.now.name}</span></h2>
      {lines.length === 0 ? <p className="empty-note">No machines: none answered, and none is in the list.</p> : (
        <div className="cards">
          {lines.map((l) => {
            const run = l.run?.pack ? rows.find((r) => r.pack === l.run!.pack && r.stack === l.run!.stack && r.runId === l.run!.runId) ?? null : null;
            const s = run ? series.find((x) => x.stack === run.stack && x.runs.some((r) => r.runId === run.runId)) : null;
            const place = s && run ? s.runs.findIndex((r) => r.runId === run.runId) + 1 : 0;
            const drain = l.queued > 0 ? queueDrain(l.machine, rows, now) : null;
            return (
              <article key={l.machine} className="machine-card" data-machine={l.machine} data-state={l.state}>
                <div className="card-head">
                  <MachineLink machine={l.machine} />
                  <span className={`card-state state-${l.state}`}>{STATE_WORD[l.state]}</span>
                </div>
                <div className="card-now"><NowSummary line={l} /></div>
                {run ? <Strip run={run} /> : null}
                {s && run ? (
                  <div className="card-series">
                    <SeriesBar series={s} pack={run.pack} />
                    <span className="small">run {place} of {s.size}</span>
                  </div>
                ) : null}
                <div className="card-queue">
                  <QueueCount line={l} />
                  {drain ? (
                    <span className="small card-drain" data-tip={drain.basis.map((b) => `${b.stack}: median ${span(b.median)} over ${b.n} finished runs`).join("\n") || "No finished run of this stack to measure from."}>
                      {drain.basis.length ? ` · about ${Math.round(drain.seconds / 3600)} h of work${drain.unknown ? `, ${drain.unknown} with no estimate yet` : ""}` : " · no estimate yet"}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
