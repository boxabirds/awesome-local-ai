// What one machine is doing now, in a line: the run and story it is on and the minutes on that story, or idle,
// waiting or unreachable; and its queue. Shared by the overview's "Now" and the machines list.
import { SILENT_MINUTES, type NowLine } from "../../../shared/overviewView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { duration } from "../../format.ts";
import { RunLink, StoryRunLink } from "../EntityLinks.tsx";

const SECONDS_PER_MINUTE = 60;

export function NowSummary({ line }: { line: NowLine }) {
  switch (line.state) {
    case "unreachable":
      return <span className="now-summary" data-now="unreachable"><span className="now-bad" data-tip={GLOSSARY.machineUnreachable.what}>unreachable</span></span>;
    case "idle":
      return <span className="now-summary" data-now="idle"><span className="idle" data-tip={GLOSSARY.machineIdle.what}>idle</span></span>;
    case "queuedOnly":
      return <span className="now-summary" data-now="queuedOnly"><span className="now-wait" data-tip={GLOSSARY.queuedOnly.what}>nothing running</span> <span className="small">({line.queued} waiting)</span></span>;
    case "running": {
      const run = line.run;
      // Busy with a run the page doesn't show: running, and no more.
      if (!run) return <span className="now-summary" data-now="running"><span aria-hidden="true" className="s-running">▶ </span>running</span>;
      const stuck = line.silent !== null && line.silent >= SILENT_MINUTES;
      return (
        <span className="now-summary" data-now="running">
          <span aria-hidden="true" className="s-running">▶ </span>
          {run.pack ? <RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} />
            : <span><span className="stack-label">{run.label} </span><b>{run.runId}</b></span>}
          <span className="sep" aria-hidden="true"> · </span>
          {line.story === null ? <span className="small">starting</span> : <>
            {run.pack ? <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={line.story}>story {line.story}</StoryRunLink> : <span>story {line.story}</span>}
            {line.storyTitle ? <span className="now-title" data-tip={line.storyTitle}> {line.storyTitle}</span> : null}
            {line.finishing ? <span className="small"> (finishing: gates and scoring)</span> : null}
          </>}
          {line.minutes !== null ? <><span className="sep" aria-hidden="true"> · </span><span className="now-min" data-tip={GLOSSARY.storyMinutes.what}>{Math.round(line.minutes)} min</span></> : null}
          {stuck ? <span className="now-stuck" data-tip={GLOSSARY.machineSilent.what}> ⚠ no activity for {duration(line.silent! * SECONDS_PER_MINUTE)}</span> : null}
        </span>
      );
    }
  }
}

/** How many jobs wait on the machine; "—" when it can't be told (unreachable). */
export function QueueCount({ line }: { line: NowLine }) {
  if (line.state === "unreachable") return <span className="missing" tabIndex={0} data-tip="Unreachable: what is queued on it can't be told.">—</span>;
  return <span className="queue-count" data-tip={GLOSSARY.queue.what}>{line.queued ? `${line.queued} queued` : "nothing queued"}</span>;
}
