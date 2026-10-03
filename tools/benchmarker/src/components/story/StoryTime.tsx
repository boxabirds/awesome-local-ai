// Where the story's time went, in every story run: one bar each, grouped by combination, all on the page's one scale,
// drawn by TimeBars.tsx (the same parts, colours, names and hovers as every other time bar).
import type { StoryPageView } from "../../../shared/storyView.ts";
import { duration } from "../../format.ts";
import { CombinationLink, MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";
import { BarRow, SegmentKey } from "../TimeBars.tsx";
import { conversationPartHref } from "../run/SplitBar.tsx";
import { Term, termName } from "./parts.tsx";

export function StoryTime({ view, storyId }: { view: StoryPageView; storyId: string }) {
  const groups = view.groups.map((g) => ({
    g,
    bars: g.entries.flatMap((e) => (e.attempt.kind === "recorded" && e.attempt.story.usage?.split ? [{ e, story: e.attempt.story }] : [])),
    without: g.entries.filter((e) => !(e.attempt.kind === "recorded" && e.attempt.story.usage?.split)),
  })).filter((x) => x.g.entries.length);
  const any = groups.some((x) => x.bars.length);
  return (
    <section className="sp-section" data-section="time" aria-labelledby="h-time">
      <div className="sp-head">
        <h2 id="h-time"><Term id="storyTimeByCombination" /></h2>
        {any ? <span className="small">one scale: the longest story run, {duration(view.scaleSeconds)}</span> : null}
      </div>
      {!any ? <p className="sp-empty">No story run of this story has a time breakdown yet.</p> : (
        <figure className="time-bars sp-time" aria-label={`${termName("storyTimeByCombination")}: story ${storyId}, by combination`}>
          <figcaption><SegmentKey /></figcaption>
          {groups.map(({ g, bars, without }) => (
            <div className="sp-time-group" key={g.stack} data-stack={g.stack}>
              <div className="sp-time-head"><CombinationLink pack={g.pack} stack={g.stack} label={g.label} /></div>
              {bars.map(({ e, story }) => (
                <BarRow key={e.run.runId} data-run={e.run.runId} split={story.usage!.split!} usage={story.usage} scaleSeconds={view.scaleSeconds} total={duration(story.usage!.split!.wall)} hrefOf={conversationPartHref(e.run, story)}
                  label={<>
                    <RunLink pack={e.run.pack} stack={e.run.stack} runId={e.run.runId} /> <StoryRunLink pack={e.run.pack} stack={e.run.stack} runId={e.run.runId} story={storyId}>this story</StoryRunLink>
                    <span className="bar-machine-inline small"> · <MachineLink machine={e.run.machine} host={e.run.host} /></span>
                  </>} />
              ))}
              {without.length ? (
                <p className="sp-time-without small">
                  No breakdown: {without.map((e, i) => (
                    <span key={e.run.runId} data-run={e.run.runId}>{i ? ", " : ""}<RunLink pack={e.run.pack} stack={e.run.stack} runId={e.run.runId} /> ({e.attempt.kind === "building" ? "being built" : e.attempt.kind === "unrecorded" ? "no record yet" : "not available"})</span>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </figure>
      )}
    </section>
  );
}
