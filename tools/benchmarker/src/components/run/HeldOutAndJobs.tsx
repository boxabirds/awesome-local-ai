// The run's evidence and provenance: held-out progress, live and of record kept apart, and every dbench job.
import type { Row } from "../../../shared/types.ts";
import { heldOutAgreement, jobsView, liveProgress, scoreOfRecord } from "../../../shared/runView.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { LiveTag, Missing, RecordTag, Section, Term, utc } from "./bits.tsx";
import { FinalScoreNote } from "./RunHeader.tsx";

export function HeldOut({ run }: { run: Row }) {
  const steps = liveProgress(run);
  const rec = scoreOfRecord(run);
  const agree = heldOutAgreement(run);
  return (
    <Section term="heldOut" id="heldout">
      <dl className="rows">
        <div data-row="live">
          <dt><Term id="liveHeldOut">After each story</Term> <LiveTag /></dt>
          <dd className="live-steps">
            {steps.length === 0 ? <span className="small">No story recorded yet.</span> : steps.map((s, i) => (
              <span key={s.id} className="step" data-story={s.id}>
                {i > 0 ? <span className="arrow" aria-hidden="true">→</span> : null}
                <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={s.id}>story {s.id}</StoryRunLink>{" "}
                {s.total !== null && s.passed !== null ? <span className="live-n">{s.passed}/{s.total}</span> : <Missing why="This story's record has no whole-suite figure (dbench reported it before its record arrived)." />}
              </span>
            ))}
          </dd>
        </div>
        <div data-row="record">
          <dt><Term id="scoreOfRecord" /> <RecordTag /></dt>
          <dd>{rec.kind === "scored" ? <strong className="record-inline">{rec.passed}/{rec.total}</strong> : <><span className="na">n/a</span> <span className="small">{rec.why}</span></>} <span className="small"><FinalScoreNote run={run} /></span></dd>
        </div>
        <div data-row="agreement">
          <dt><Term id="heldOutAgreement" /></dt>
          <dd data-agreement={agree.kind}>
            {agree.kind === "agree" ? <span className="ok-text">✓ they agree: {agree.passed}/{agree.total}</span>
              : agree.kind === "differ" ? <span className="bad-text">they differ: live {agree.live}/{agree.total}, of record {agree.record}/{agree.total}</span>
              : <span className="small">Can't compare. {agree.why}</span>}
          </dd>
        </div>
      </dl>
    </Section>
  );
}

export function Jobs({ run }: { run: Row }) {
  const jobs = jobsView(run);
  const restarts = jobs.filter((j) => j.restart).length;
  return (
    <Section term="jobs" id="jobs" aside={restarts ? <span className="warn">restarted {restarts === 1 ? "once" : `${restarts} times`}: {jobs.length} jobs</span> : null}>
      {jobs.length === 0 ? <p className="rp-empty">No dbench job: this run is known from its record alone.</p> : (
        <div className="table-scroll">
          <table className="rp-table jobs" aria-label="Jobs">
            <thead>
              <tr>
                <th>Job</th><th>dbench id</th><th><Term id="machine" /></th><th>Status</th>
                <th><Term id="jobSubmitted" /></th><th><Term id="jobUpdated" /></th><th><Term id="jobReason" /></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} data-job={j.id}>
                  <td className="nowrap">job {j.place} of {j.of} for {run.runId}{j.restart ? <span className="small"> (restart)</span> : null}</td>
                  <td className="mono nowrap">{j.id}</td>
                  <td>{j.node}</td>
                  <td><span className={`job-status j-${j.status}`}>{j.status}</span></td>
                  <td className="nowrap">{j.submittedAt !== null ? utc(j.submittedAt) : <Missing why="dbench didn't say when it was submitted." />}</td>
                  <td className="nowrap">{j.updatedAt !== null ? utc(j.updatedAt) : <Missing why="dbench hasn't reported on it since." />}</td>
                  <td>{j.reason || <span className="small">none given</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
