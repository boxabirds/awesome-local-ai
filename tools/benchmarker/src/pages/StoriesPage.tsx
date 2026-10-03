// The stories of a pack version, as a page: every story any run has in scope, each a link to its page. The Stories
// tab and the story pages' Stories crumb lead here; the story page's side list is the same list beside one story.
import type { Row } from "../../shared/types.ts";
import type { Route } from "../../shared/routes.ts";
import { storyList } from "../../shared/storyView.ts";
import { Breadcrumb, StoryLink } from "../components/EntityLinks.tsx";
import { Term } from "../components/story/parts.tsx";
import "./story.css";

export function StoriesPage({ route, pack, runs }: { route: Route; pack: string; runs: Row[] }) {
  const list = storyList(runs);
  return (
    <div className="page stories-page" data-page="stories" data-pack={pack}>
      <Breadcrumb route={route} />
      <header className="si-header">
        <div className="eyebrow">Stories · {pack} · {runs[0]?.family ?? ""}</div>
        <h1><Term id="storyList" /></h1>
      </header>
      <ol className="stories-index" aria-label="Stories">
        {list.map((s) => (
          <li key={s.id} data-story={s.id}>
            <StoryLink pack={pack} story={s.id}>
              <span className="sn">{s.id}</span> <span className="st">{s.title || <span className="untitled">not built yet</span>}</span>
            </StoryLink>
          </li>
        ))}
      </ol>
    </div>
  );
}
