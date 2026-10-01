// Who the run is and how it came out: identity, status, the score of record (or why there is none), agent time,
// and the ways out to judging and the record.
import type { Row, State } from "../../../shared/types.ts";
import { agentTime, interventionsOf, scoreOfRecord, statusView } from "../../../shared/runView.ts";
import { finalScoreNote, finalScoreOwed } from "../../../shared/finalScore.ts";
import { InterventionMark } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink } from "../EntityLinks.tsx";
import { JudgeCell } from "../JudgeCell.tsx";
import { LinksCell } from "../LinksCell.tsx";
import { duration, ordinal, qualityClass } from "../../format.ts";
import { LiveTag, Missing, RecordTag, Stat, Term, utc } from "./bits.tsx";

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

/** While a finished run's final score is owed: whether the harness retries it by itself or says a person is needed. */
export function FinalScoreNote({ run }: { run: Row }) {
  const note = finalScoreNote(run);
  return note ? <span className="final-score-note" data-final-score={finalScoreOwed(run)}>{note}</span> : null;
}

function RecordScore({ run, state }: { run: Row; state: State }) {
  const r = scoreOfRecord(run);
  if (r.kind === "none") {
    return (
      <Stat term="scoreOfRecord" tag={<RecordTag />} sub={<><span className="why">{r.why}</span> <FinalScoreNote run={run} /></>}>
        <span className="na" data-tip={`${GLOSSARY.noScore.what} ${r.why}`} data-reason={r.reason}>n/a</span>
      </Stat>
    );
  }
  const link = state.web && run.dir ? `${state.web}/blob/${state.branch}/${run.dir}/rescore/${r.version}/per-story.md` : null;
  const n = <><strong className={`record-n ${qualityClass(r.passed / r.total)}`}>{r.passed}</strong><span className="record-of">/{r.total}</span></>;
  return (
    <Stat term="scoreOfRecord" tag={<RecordTag />} sub={<>
      re-scored {r.at ? utc(r.at) : "(no time recorded)"} · suite <span className="mono">{r.version}</span>
      {r.flaky ? ` · ${r.flaky} flaky` : ""}
      {r.currentSuite ? null : <span className="warn" data-tip={GLOSSARY.suite.what}> · not the current suite ({run.suite})</span>}
      {" "}<FinalScoreNote run={run} />
    </>}>
      {link ? <a className="record-link" href={link} target="_blank" rel="noopener" data-tip={`${r.passed} of ${r.total} held-out tests pass · per-story results`}>{n}</a> : n}
    </Stat>
  );
}

function AgentTimeStat({ run }: { run: Row }) {
  const t = agentTime(run);
  return (
    <Stat term="agentTime" sub={<>
      {t.recordedSeconds !== null ? <>over {t.recordedStories - t.untimedStories} recorded {t.recordedStories - t.untimedStories === 1 ? "story" : "stories"}</> : null}
      {t.untimedStories ? <> · {t.untimedStories} without a time</> : null}
      {t.liveSeconds !== null ? <div className="live-line"><span className="live-n">{duration(t.liveSeconds)}</span> so far, the running story included <LiveTag /></div> : null}
    </>}>
      {t.recordedSeconds !== null ? <span className="big-n">{duration(t.recordedSeconds)}</span>
        : <Missing why={run.status === "queued" ? "Nothing recorded yet: the run is queued." : "No recorded story of this run has a time yet."} />}
    </Stat>
  );
}

export function RunHeader({ run, state }: { run: Row; state: State }) {
  return (
    <div className="rp-header" data-section="header">
      <div className="eyebrow">Run</div>
      <h1><CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> <span className={`run-id${run.invalid ? " invalid-run" : ""}`}>{run.runId}</span></h1>
      <dl className="facts">
        <div><dt><Term id="machine" /></dt><dd data-fact="machine"><MachineLink machine={run.machine} host={run.host || "no hardware recorded"} /></dd></div>
        <div><dt><Term id="packVersion" /></dt><dd data-fact="packVersion" className="mono">{run.packVersion || <Missing why="The record doesn't name its pack version (a run with no record yet)." />}</dd></div>
        <div><dt><Term id="suite" /></dt><dd data-fact="suite" className="mono">{run.suite}</dd></div>
        <div><dt><Term id="runStatus" /></dt><dd data-fact="status"><StatusBadge run={run} /> <InterventionMark list={interventionsOf(run)} /></dd></div>
      </dl>
      <div className="outcome">
        <RecordScore run={run} state={state} />
        <AgentTimeStat run={run} />
        <div className="run-links" data-section="links">
          {/* Judging opens as the Judge cell builds it; until it's ready, the stage says why not. */}
          {run.stages.judge === "ready" ? <JudgeCell row={run} building={false} url={state.judgeUrl} /> : <span className="wait judge-wait">Judge: {run.stages.judge}</span>}
          <LinksCell row={run} web={state.web} branch={state.branch} />
        </div>
      </div>
    </div>
  );
}
