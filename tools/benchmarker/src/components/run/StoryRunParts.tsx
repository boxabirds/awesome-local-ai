// The story run page's header, what's known of a story run that isn't recorded, and the ways around it.
import type { Row, State } from "../../../shared/types.ts";
import { interventionsOf, neighbours, otherRuns, storyRunState, type StoryRunState } from "../../../shared/runView.ts";
import { InterventionMark } from "../RunMarks.tsx";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { CombinationLink, MachineLink, RunLink, StoryLink, StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { LiveTag, Missing, Section, Stat, full } from "./bits.tsx";
import { StatusBadge } from "./RunHeader.tsx";

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

export function StoryRunHeader({ run, st, storyId, title }: { run: Row; st: StoryRunState; storyId: string; title: string }) {
  const story = st.kind === "recorded" ? st.story : null;
  const secs = story?.usage?.agentSeconds ?? null;
  return (
    <div className="rp-header" data-section="header">
      <div className="eyebrow">Story run</div>
      <h1>Story {storyId}{title ? <span className="story-title-h"> · {title}</span> : <span className="small"> · title not known yet</span>}</h1>
      <div className="of-run">
        <RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} invalid={run.invalid} /> <span className="small">on <MachineLink machine={run.machine} host={run.host} /> · run</span> <StatusBadge run={run} />
        {" "}<InterventionMark list={interventionsOf(run, storyId)} />
      </div>
      <div className="outcome">
        <Stat term="storyStatus"><span data-fact="storyStatus"><StoryStatus st={st} /></span></Stat>
        {story ? <>
          <Stat term="storyHeldOut" tag={<LiveTag />} sub="this story's own tests, after it">
            <span data-fact="own">{fraction(story.ownPassed, story.ownTotal, "This story's own held-out result isn't in its record.")}</span>
          </Stat>
          <Stat term="cumulativeHeldOut" tag={<LiveTag />} sub="every story's tests so far">
            <span data-fact="cumulative">{fraction(story.passed, story.total, "The whole-suite figure arrives with the story's record; dbench reported this story first.")}</span>
          </Stat>
          <Stat term="agentTime"><span data-fact="agentTime">{secs !== null ? <span className="big-n">{duration(secs)}</span> : <Missing why="This story's record has no time." />}</span></Stat>
        </> : null}
      </div>
    </div>
  );
}

/** A story run with no record: what is known instead of an error. */
export function NotRecorded({ run, st }: { run: Row; st: Exclude<StoryRunState, { kind: "recorded" }> }) {
  if (st.kind === "inProgress") {
    return (
      <Section term="storyStatus" id="progress" aside={<LiveTag />}>
        <p className="state-note">Being built now. These are live figures; the record, with where the time went and the conversation profile, arrives when the story ends.</p>
        {/* The section is tagged live; the figures are styled as live too, so none can pass for a record. */}
        <div className="stats live-stats">
          <Stat term="agentTime">{st.agentMinutes !== null ? <span className="live-n">{duration(st.agentMinutes * MINUTE)}</span> : <Missing why="dbench hasn't reported the agent's time on this story yet." />}</Stat>
          <Stat term="calls">{st.calls !== null ? <span className="live-n">{full(st.calls)}</span> : <Missing why="dbench hasn't reported calls on this story yet." />}</Stat>
          <Stat term="outTokens">{st.outputTokens !== null ? <span className="live-n">{short(st.outputTokens)}</span> : <Missing why="dbench hasn't reported output tokens on this story yet." />}</Stat>
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
              <ul className="siblings">
                {siblings.map((r) => {
                  const s = storyRunState(r, storyId);
                  return (
                    <li key={r.runId} data-run={r.runId}>
                      <StoryRunLink pack={r.pack} stack={r.stack} runId={r.runId} story={storyId} invalid={r.invalid}>{r.runId} · story {storyId}</StoryRunLink>{" "}
                      <span className="small">{s.kind === "recorded" ? s.story.status || "recorded" : s.kind === "inProgress" ? "in progress" : s.kind === "notBuilt" ? "not built" : "not in scope"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </dd>
        </div>
        <div data-row="story"><dt>Story {storyId} in every combination</dt><dd><StoryLink pack={run.pack} story={storyId}>story {storyId}: every combination's runs</StoryLink></dd></div>
        <div data-row="run"><dt>The run</dt><dd><RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} invalid={run.invalid} /></dd></div>
        <div data-row="combination"><dt>The combination</dt><dd><CombinationLink pack={run.pack} stack={run.stack} label={run.label} /></dd></div>
      </dl>
    </Section>
  );
}

