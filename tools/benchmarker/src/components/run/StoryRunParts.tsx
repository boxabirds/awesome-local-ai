// The story run page's header, what's known of a story run that isn't recorded, and the ways around it.
import type { Row, RunStatus, State } from "../../../shared/types.ts";
import { interventionsOf, neighbours, otherRuns, storyRunState, type StoryRunState } from "../../../shared/runView.ts";
import { InterventionMark, interventionHref } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink, RunLink, StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Stat, Term, full } from "./bits.tsx";
import { StatusBadge } from "./RunHeader.tsx";
import { RunSectionLists } from "../RunGroupHead.tsx";

const MINUTE = 60;

/** DONE, PARTIAL, or where a story run without a record stands. */
function StoryStatus({ st }: { st: StoryRunState }) {
  switch (st.kind) {
    case "recorded": {
      const s = st.story.status || "unknown";
      return <span className={`story-status st-${s.toLowerCase()}`} data-tip={GLOSSARY.storyStatus.what}>{s}</span>;
    }
    case "inProgress": return <span className="story-status st-progress">▶ in progress</span>;
    case "notBuilt": return <span className="story-status st-unbuilt">not built</span>;
    case "outOfScope": return <span className="story-status st-unbuilt">not in this run's scope</span>;
  }
}

const fraction = (p: number | null, t: number | null, why: string) => (t !== null && p !== null ? <span className="live-n">{p}/{t}</span> : <Missing why={why} />);

/** The run's states that change what its story means: the conversation may still grow, or was cut short. A run
 * that finished, or is queued, adds nothing to a story's own status and is not shown beside it. */
const RUN_STATES_SHOWN: RunStatus[] = ["running", "failed", "stopped", "cancelled"];
const runStateShown = (run: Row) => RUN_STATES_SHOWN.includes(run.status);

/** The story's number and title as a page's h1; a story whose title isn't known yet is its number alone. */
const StoryTitle = ({ storyId, title }: { storyId: string; title: string }) => (
  <h1>Story {storyId}{title ? <span className="story-title-h"> · {title}</span> : null}</h1>
);

/** The story-run page's header card: the story, its run and machine, then its figures, each at one size. The
 * combination is in the breadcrumb and on the run link's hover; the terms' explanations are their hovers. */
export function StoryRunHeader({ run, st, storyId, title }: { run: Row; st: StoryRunState; storyId: string; title: string }) {
  const story = st.kind === "recorded" ? st.story : null;
  const secs = story?.usage?.agentSeconds ?? null;
  return (
    <div className="rp-header" data-section="header">
      <StoryTitle storyId={storyId} title={title} />
      <div className="of-run">
        <RunLink pack={run.pack} stack={run.stack} runId={run.runId} /> <span className="small">on <MachineLink machine={run.machine} host={run.host} /></span>
        {runStateShown(run) ? <> <StatusBadge run={run} /></> : null}
        {" "}<InterventionMark list={interventionsOf(run, storyId)} to={interventionHref(run, storyId)} />
      </div>
      {story?.notComparable ? <p className="not-compared" data-fact="notCompared"><Term id="notCompared" />: {story.notComparable}</p> : null}
      <div className="outcome">
        <Stat term="storyStatus"><span data-fact="storyStatus"><StoryStatus st={st} /></span></Stat>
        {story ? <>
          <Stat term="storyHeldOut">
            <span className="held-out-parts">
              <span data-part="own"><Term id="storyHeldOut">This story</Term> <span data-fact="own">{fraction(story.ownPassed, story.ownTotal, "Not available.")}</span></span>
              <span data-part="cumulative"><Term id="cumulativeHeldOut">Suite so far</Term> <span data-fact="cumulative">{fraction(story.passed, story.total, "Not available.")}</span></span>
            </span>
          </Stat>
          <Stat term="agentTime"><span data-fact="agentTime">{secs !== null ? duration(secs) : <Missing why="This story's record has no time." />}</span></Stat>
        </> : null}
      </div>
    </div>
  );
}

/** The story run in one line, for the pages about its conversation: the story's number and title, then its
 * status, its held-out fraction and its agent time in small type, and the run's state with its machine only while
 * that matters (RUN_STATES_SHOWN). Everything else about the story run is one crumb back. */
export function StoryRunLine({ run, st, storyId, title }: { run: Row; st: StoryRunState; storyId: string; title: string }) {
  const story = st.kind === "recorded" ? st.story : null;
  const secs = story?.usage?.agentSeconds ?? null;
  const sep = <span className="srl-sep" aria-hidden="true"> · </span>;
  return (
    <div className="story-run-line" data-section="header">
      <StoryTitle storyId={storyId} title={title} />
      <span className="srl-facts small">
        <span data-fact="storyStatus"><StoryStatus st={st} /></span>
        {story ? <>{sep}<span data-fact="own" data-tip={GLOSSARY.storyHeldOut.what}>{fraction(story.ownPassed, story.ownTotal, "Not available.")}</span></> : null}
        {story ? <>{sep}<span data-fact="agentTime" data-tip={GLOSSARY.agentTime.what}>{secs !== null ? duration(secs) : <Missing why="This story's record has no time." />}</span></> : null}
        {runStateShown(run) ? <>{sep}<StatusBadge run={run} /> <span className="srl-on">on <MachineLink machine={run.machine} host={run.host} /></span></> : null}
        {" "}<InterventionMark list={interventionsOf(run, storyId)} to={interventionHref(run, storyId)} />
      </span>
    </div>
  );
}

/** A story run with no record: what is known instead of an error. */
export function NotRecorded({ run, st }: { run: Row; st: Exclude<StoryRunState, { kind: "recorded" }> }) {
  if (st.kind === "inProgress") {
    return (
      <Section term="storyStatus" id="progress">
        <p className="state-note">Being built now.</p>
        <div className="stats live-stats">
          <Stat term="agentTime">{st.agentMinutes !== null ? <span className="live-n">{duration(st.agentMinutes * MINUTE)}</span> : <Missing why="No agent time reported on this story yet." />}</Stat>
          <Stat term="calls">{st.calls !== null ? <span className="live-n">{full(st.calls)}</span> : <Missing why="No calls reported on this story yet." />}</Stat>
          <Stat term="outTokens">{st.outputTokens !== null ? <span className="live-n">{short(st.outputTokens)}</span> : <Missing why="No output tokens reported on this story yet." />}</Stat>
        </div>
      </Section>
    );
  }
  const text = st.kind === "notBuilt" ? st.why : `The run's scope doesn't include this story: it has ${run.storiesWorking.scope} in scope.`;
  return (
    <Section term="storyStatus" id="progress">
      <p className="state-note" data-state={st.kind}>{text}</p>
    </Section>
  );
}

export function StoryNav({ run, state, storyId }: { run: Row; state: State; storyId: string }) {
  const { prev, next } = neighbours(run, storyId);
  const siblings = otherRuns(run, state.rows);
  const link = (id: string | null, rel: string) => id
    ? <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={id}>{rel} story {id}</StoryRunLink>
    : <span className="small">{rel === "←" ? "first story" : "last story"}</span>;
  return (
    <Section term="storyNav" id="nav">
      <dl className="rows">
        <div data-row="neighbours"><dt>In this run</dt><dd className="prevnext"><span data-nav="prev">{link(prev, "←")}</span><span data-nav="next">{link(next, "→")}</span></dd></div>
        <div data-row="siblings">
          <dt>Story {storyId} in other runs</dt>
          <dd>
            {siblings.length === 0 ? <span className="small">the combination has no other run in this pack</span> : (
              <RunSectionLists items={siblings} runOf={(r) => r} className="siblings" render={(r) => {
                  const s = storyRunState(r, storyId);
                  return (
                    <li key={r.runId} data-run={r.runId}>
                      <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId}>{r.runId} · story {storyId}</StoryRunLink>{" "}
                      <span className="small">{s.kind === "recorded" ? s.story.status || "recorded" : s.kind === "inProgress" ? "in progress" : s.kind === "notBuilt" ? "not built" : "not in scope"}</span>
                    </li>
                  );
                }} />
            )}
          </dd>
        </div>
        <div data-row="story"><dt>Story {storyId} in every combination</dt><dd><StoryLink pack={run.pack} story={storyId}>story {storyId}: every combination's runs</StoryLink></dd></div>
        <div data-row="run"><dt>The run</dt><dd><RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} /></dd></div>
        <div data-row="combination"><dt>The combination</dt><dd><CombinationLink pack={run.pack} stack={run.stack} label={run.label} /></dd></div>
      </dl>
    </Section>
  );
}

