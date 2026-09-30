// What the machine is doing: the running job with its live activity, the queue in dbench's order, and jobs that
// ended in the last day; each with its operations, and a form to queue a run beside them.
import type { Row } from "../../../shared/types.ts";
import { jobPlace, machineJobs, runningStory, silentMinutes, SILENT_MINUTES, endedAt } from "../../../shared/overviewView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration, ordinal, shortAction } from "../../format.ts";
import { RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { LiveTag, Missing, Term, utc } from "../run/bits.tsx";
import { JobOps } from "./JobOps.tsx";
import { QueueForm } from "./QueueForm.tsx";
import type { MachineInfo } from "./machineApi.ts";

const SECONDS_PER_MINUTE = 60;
const TOKENS_PER_K = 1000;

/** "job 2 of 3", with the dbench id on hover: a job is never shown as a bare dbench id. */
function JobName({ row }: { row: Row }) {
  const p = jobPlace(row);
  const id = row.live!.jobId;
  return <span className="job-name" tabIndex={0} data-tip={`${GLOSSARY.jobPlace.what} dbench id: ${id}`}>{p ? `job ${p.place} of ${p.of}` : "job"}<span className="sr-only"> ({id})</span></span>;
}

const Run = ({ row }: { row: Row }) => <RunLink pack={row.pack} stack={row.stack} runId={row.runId} label={row.label} />;

function Activity({ row }: { row: Row }) {
  const l = row.live!;
  const fresh = !l.calls && !l.agentMinutes;
  const bits: string[] = [];
  if (fresh) bits.push("first numbers within a minute");
  else {
    // Zero after the story has run means not counted yet (Claude counts at the story's end), not none.
    if (l.calls) bits.push(`${l.calls} calls`);
    if (l.outputTokens) bits.push(`${Math.round(l.outputTokens / TOKENS_PER_K)}k output tokens`);
  }
  if (l.tasksTotal !== null) bits.push(`tasks ${l.tasksWritten}/${l.tasksTotal}`);
  const action = l.lastActivity ? shortAction(l.lastActivity) : l.logTail.at(-1);
  return (
    <div className="mp-activity" data-part="activity">
      <span className="label"><Term id="activity" /> <LiveTag /></span>
      <span>{bits.length ? bits.join(" · ") : <Missing why="dbench hasn't reported any activity for this story yet." />}</span>
      {action ? <div className="log" data-tip={action}>{action}</div> : null}
    </div>
  );
}

function RunningJob({ row, now }: { row: Row; now: number }) {
  const l = row.live!;
  const { story, finishing } = runningStory(row);
  const silent = silentMinutes(row, now);
  return (
    <div className="job-line mp-job mp-running" data-job={l.jobId} data-status="running">
      <div className="mp-job-head">
        <span className="s-running" aria-hidden="true">▶</span>
        <Run row={row} />
        <JobName row={row} />
        <span className="mp-ops"><JobOps node={row.node ?? row.machine} jobId={l.jobId} status={l.status} /></span>
      </div>
      <div className="mp-story" data-part="story">
        {story === null ? <span className="small">starting: no story yet</span> : <>
          <StoryRunLink pack={row.pack} stack={row.stack} runId={row.runId} story={story}>story {story}</StoryRunLink>
          {l.storiesInScope ? <span className="small"> of {l.storiesInScope}</span> : null}
          {l.storyTitle ? <span className="mp-title-text"> {l.storyTitle}</span> : null}
          {finishing ? <span className="small"> (finishing: gates and scoring)</span> : null}
        </>}
      </div>
      <div className="mp-times" data-part="times">
        {l.agentMinutes !== null ? <span data-tip={GLOSSARY.storyMinutes.what}><b>{Math.round(l.agentMinutes)}</b> {GLOSSARY.storyMinutes.name}</span> : <Missing why="The harness hasn't reported agent minutes for this story yet." />}
        {l.runStartedAt !== null ? <span data-tip={GLOSSARY.runElapsed.what}>{GLOSSARY.runElapsed.name} {duration(now - l.runStartedAt)}</span> : null}
        {silent !== null && silent >= SILENT_MINUTES ? <span className="now-stuck" data-tip={GLOSSARY.needSilent.what}>⚠ no activity for {duration(silent * SECONDS_PER_MINUTE)}</span> : null}
      </div>
      <Activity row={row} />
    </div>
  );
}

function QueuedJob({ row }: { row: Row }) {
  const l = row.live!;
  return (
    <li className="job-line mp-job" data-job={l.jobId} data-status="queued">
      {l.queue ? <span className="mp-pos" data-tip="Its place on the machine, counting the running job.">{ordinal(l.queue.position)}</span>
        : <span className="mp-pos"><Missing why="dbench didn't give its place in the queue." /></span>}
      <Run row={row} />
      <JobName row={row} />
      <span className="mp-ops"><JobOps node={row.node ?? row.machine} jobId={l.jobId} status={l.status} /></span>
    </li>
  );
}

function EndedJob({ row }: { row: Row }) {
  const l = row.live!;
  const at = endedAt(row);
  return (
    <li className="job-line mp-job" data-job={l.jobId} data-status={l.status}>
      <span className={`job-status j-${l.status}`}>{l.status}</span>
      <Run row={row} />
      <JobName row={row} />
      <span className="small">{at !== null ? utc(at) : <Missing why="Neither dbench nor the run's record says when it ended." />}</span>
      <span className="mp-ops"><JobOps node={row.node ?? row.machine} jobId={l.jobId} status={l.status} /></span>
    </li>
  );
}

/** `isNode`: dbench knows the machine (it answered for it, or it is in the machine list). */
export function MachineNow({ machine, all, info, listed, isNode, now }: { machine: string; all: Row[]; info: MachineInfo | undefined; listed: boolean; isNode: boolean; now: number }) {
  const jobs = machineJobs(machine, all);
  return (
    <section className="mp-section" data-section="now" aria-labelledby="h-mp-now">
      <div className="mp-head"><h2 id="h-mp-now"><Term id="machineNow" /></h2>
        <span className="small">{jobs.running.length ? "running" : "nothing running"} · {jobs.queued.length ? `${jobs.queued.length} queued` : "nothing queued"}</span></div>
      {!isNode ? <p className="mp-empty">Not a dbench node: the benchmarker can't run or queue anything here. Its runs are below.</p> : (
        <div className="mp-now-grid">
          <div className="mp-jobs">
            {jobs.running.length ? jobs.running.map((r) => <RunningJob key={r.live!.jobId} row={r} now={now} />)
              : <p className="mp-idle" data-now={jobs.queued.length ? "queuedOnly" : "idle"} data-tip={GLOSSARY[jobs.queued.length ? "queuedOnly" : "needIdle"].what}>
                  {jobs.queued.length ? "Nothing running: the queue is waiting." : <><span className="idle">Idle</span>: nothing running, nothing queued.</>}</p>}
            <h3 data-tip={GLOSSARY.queue.what}>{GLOSSARY.queue.name}</h3>
            {jobs.queued.length ? <ol className="mp-queue" aria-label="Queue">{jobs.queued.map((r) => <QueuedJob key={r.live!.jobId} row={r} />)}</ol> : <p className="mp-empty">Nothing queued.</p>}
            {jobs.ended.length ? <>
              <h3 data-tip={GLOSSARY.endedJobs.what}>{GLOSSARY.endedJobs.name}</h3>
              <ul className="mp-ended" aria-label="Ended in the last day">{jobs.ended.map((r) => <EndedJob key={r.live!.jobId} row={r} />)}</ul>
            </> : null}
          </div>
          {info?.ok ? <QueueForm node={machine} combos={info.node?.combinations ?? []} current={jobs.running[0]?.stack} />
            : <div className="queue-form small" data-part="no-queue-form">{info ? `Unreachable: nothing can be queued on ${machine} until it answers.`
              : listed ? `${machine} isn't in the machine list, so runs can't be queued on it from here. Add it on the machines list.` : "Waiting for the machine list…"}</div>}
        </div>
      )}
    </section>
  );
}
