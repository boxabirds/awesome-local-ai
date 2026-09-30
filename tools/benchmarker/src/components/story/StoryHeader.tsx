// The story page's header: the story's number and title, its held-out test count (each count the runs used, when
// suite versions differ), how many story runs the page shows, and the stories before and after it.
import type { StoryItem, StoryPageView, TestCount } from "../../../shared/storyView.ts";
import { storyHref, withParams } from "../../../shared/routes.ts";
import { StoryLink } from "../EntityLinks.tsx";
import { KeepState, Missing, Term } from "./parts.tsx";

function Neighbour({ pack, s, rel, params }: { pack: string; s: StoryItem | null; rel: "prev" | "next"; params: Record<string, string | undefined> }) {
  const arrow = rel === "prev" ? "←" : "→";
  if (!s) return <span className="small" data-nav={rel}>{rel === "prev" ? "first story" : "last story"}</span>;
  return (
    <span data-nav={rel}>
      <KeepState href={withParams(storyHref(pack, s.id), params)}>
        <StoryLink pack={pack} story={s.id}>{rel === "prev" ? `${arrow} ` : ""}story {s.id}{rel === "next" ? ` ${arrow}` : ""}</StoryLink>
      </KeepState>
    </span>
  );
}

function Tests({ tests }: { tests: TestCount[] }) {
  if (!tests.length) return <Missing why="No run has recorded this story's held-out tests yet." />;
  const [main, ...rest] = tests;
  return (
    <>
      <span className="big-n" data-tests={main.total}>{main.total}</span>
      {rest.length ? (
        <span className="small tests-differ" tabIndex={0} data-tip={`Runs counted a different number of tests: ${tests.map((t) => `${t.total} in ${t.runs} run${t.runs === 1 ? "" : "s"}`).join(", ")}. Runs scored under another suite version count another set of tests.`}>
          {" "}in {main.runs} run{main.runs === 1 ? "" : "s"}; {rest.map((t) => `${t.total} in ${t.runs}`).join(", ")}
        </span>
      ) : null}
    </>
  );
}

export function StoryHeader({ pack, family, id, title, known, tests, prev, next, view, params }: {
  pack: string; family: string; id: string; title: string; known: boolean; tests: TestCount[];
  prev: StoryItem | null; next: StoryItem | null; view: StoryPageView; params: Record<string, string | undefined>;
}) {
  const combos = view.groups.filter((g) => g.entries.length).length;
  return (
    <div className="sp-header" data-section="header">
      <div className="eyebrow">Story · {pack} · {family}</div>
      <h1>Story {id}{title ? <span className="story-title-h">: {title}</span> : <span className="small"> · {known ? "title not known yet: no run has recorded it" : "not in this pack version"}</span>}</h1>
      <div className="sp-facts">
        <div className="sp-fact" data-fact="tests">
          <div className="sp-label"><Term id="storyHeldOutTests" /></div>
          <div><Tests tests={tests} /></div>
        </div>
        <div className="sp-fact" data-fact="runs">
          <div className="sp-label"><Term id="storyByCombination">Story runs</Term></div>
          <div><span className="big-n">{view.storyRuns}</span> <span className="small">in {combos} combination{combos === 1 ? "" : "s"}{view.notBuilt ? ` · ${view.notBuilt} run${view.notBuilt === 1 ? "" : "s"} not built` : ""}</span></div>
        </div>
        <nav className="sp-fact prevnext" aria-label="Story before and after" data-fact="nav">
          <div className="sp-label">Stories</div>
          <div>{known ? <><Neighbour pack={pack} s={prev} rel="prev" params={params} /> <Neighbour pack={pack} s={next} rel="next" params={params} /></>
            : <span className="small">not among this pack version's stories: choose one from the list</span>}</div>
        </nav>
      </div>
    </div>
  );
}
