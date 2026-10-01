// Who the run is and how it came out: identity, status, the score of record (or why there is none), agent time,
// and the ways out to judging and the record.
import type { Row, State } from "../../../shared/types.ts";
import { agentTime, interventionsOf, leadScore, PENDING, scoreOfRecord, statusView } from "../../../shared/runView.ts";
import { InterventionMark } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink } from "../EntityLinks.tsx";
import { JudgeCell } from "../JudgeCell.tsx";
import { LinksCell } from "../LinksCell.tsx";
import { duration, ordinal, qualityClass } from "../../format.ts";
import { Missing, Stat, Term, utc } from "./bits.tsx";

export function StatusBadge({ run }: { run: Row }) {
  const v = statusView(run);
  const note = v.queuePosition !== null ? `${ordinal(v.queuePosition)} on ${run.node ?? run.machine}` : v.note || (v.endedAt ? utc(v.endedAt) : "");
  return (
    <span className="status-badge" data-status={v.status}>
      <span className={`status-word s-${v.status}`}><span aria-hidden="true">{v.icon} </span>{v.status}</span>
      {note ? <span className="status-note"> · {note}</span> : null}
    </span>
  );
}

/** A finished run's score that isn't in yet: one word, nothing about why. */
export function PendingScore() {
  return <span className="na pending" data-reason="pending" data-tip={GLOSSARY.noScore.what}>{PENDING}</span>;
}

/** The first thing on the page: the score of record as "62/75 held-out tests pass"; a running run's live score so
 * far, said to be so far and over how many stories; a finished run with none: "—". */
function LeadScore({ run, state }: { run: Row; state: State }) {
  const lead = leadScore(run);
  const r = scoreOfRecord(run);
  if (lead.kind === "none") {
    return (
      <div className="lead-score" data-section="lead" data-lead="none">
        <Stat term="scoreOfRecord">
          {r.kind === "none" && r.reason === "pending" ? <PendingScore /> : <span className="na" data-reason={r.kind === "none" ? r.reason : "pending"} data-tip={GLOSSARY.noScore.what}>—</span>}
        </Stat>
      </div>
    );
  }
  const n = <><strong className={`record-n ${qualityClass(lead.passed / lead.total)}`}>{lead.passed}</strong><span className="record-of">/{lead.total}</span></>;
  if (lead.kind === "live") {
    return (
      <div className="lead-score" data-section="lead" data-lead="live">
        <Stat term="liveHeldOut">
          <span className="lead-n live-n">{n}</span> <span className="lead-text">held-out tests pass</span>
        </Stat>
      </div>
    );
  }
  const rec = r.kind === "scored" ? r : null;
  const link = state.web && run.dir && rec ? `${state.web}/blob/${state.branch}/${run.dir}/rescore/${rec.version}/per-story.md` : null;
  return (
    <div className="lead-score" data-section="lead" data-lead="record">
      <Stat term="scoreOfRecord" sub={rec?.flaky ? `${rec.flaky} flaky` : undefined}>
        <span className="lead-n">{link ? <a className="record-link" href={link} target="_blank" rel="noopener" data-tip={`${lead.passed} of ${lead.total} held-out tests pass · per-story results`}>{n}</a> : n}</span>
        {" "}<span className="lead-text">held-out tests pass</span>
      </Stat>
    </div>
  );
}

function AgentTimeStat({ run }: { run: Row }) {
  const t = agentTime(run);
  return (
    <Stat term="agentTime" sub={<>
      {t.recordedSeconds !== null ? <>over {t.recordedStories - t.untimedStories} {t.recordedStories - t.untimedStories === 1 ? "story" : "stories"}</> : null}
      {t.untimedStories ? <> · {t.untimedStories} without a time</> : null}
      {t.liveSeconds !== null ? <div className="live-line"><span className="live-n">{duration(t.liveSeconds)}</span> including the running story</div> : null}
    </>}>
      {t.recordedSeconds !== null ? <span className="big-n">{duration(t.recordedSeconds)}</span>
        : <Missing why={run.status === "queued" ? "Nothing yet: the run is queued." : "No story of this run has a time yet."} />}
    </Stat>
  );
}

export function RunHeader({ run, state }: { run: Row; state: State }) {
  return (
    <div className="rp-header" data-section="header">
      <LeadScore run={run} state={state} />
      <div className="eyebrow">Run</div>
      <h1><CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> <span className="run-id">{run.runId}</span></h1>
      <dl className="facts">
        <div><dt><Term id="machine" /></dt><dd data-fact="machine"><MachineLink machine={run.machine} host={run.host} /></dd></div>
        <div><dt><Term id="packVersion" /></dt><dd data-fact="packVersion" className="mono">{run.packVersion || <Missing why="The record doesn't name its pack version (a run with no record yet)." />}</dd></div>
        <div><dt><Term id="suite" /></dt><dd data-fact="suite" className="mono">{run.suite}</dd></div>
        <div><dt><Term id="runStatus" /></dt><dd data-fact="status"><StatusBadge run={run} /> <InterventionMark list={interventionsOf(run)} /></dd></div>
      </dl>
      <div className="outcome">
        <AgentTimeStat run={run} />
        <div className="run-links" data-section="links">
          {/* Judging opens once the run can be judged; until then there is nothing to open. */}
          {run.judgeReady ? <JudgeCell row={run} url={state.judgeUrl} /> : null}
          <LinksCell row={run} web={state.web} branch={state.branch} />
        </div>
      </div>
    </div>
  );
}
