// The stories of this pack version, down the side: each a link to its story page that keeps the page's state (the
// comparison) in the address. The story shown is marked as the current page.
import type { StoryItem } from "../../../shared/storyView.ts";
import { sameStory } from "../../../shared/storyView.ts";
import { storyHref, withParams } from "../../../shared/routes.ts";
import { StoryLink } from "../EntityLinks.tsx";
import { KeepState, Term, termName } from "./parts.tsx";

export function StoryList({ pack, stories, current, params }: { pack: string; stories: StoryItem[]; current: string; params: Record<string, string | undefined> }) {
  return (
    <nav className="story-nav" aria-label={termName("storyList")}>
      <div className="story-nav-head"><Term id="storyList" /></div>
      <ol>
        {stories.map((s) => {
          const here = sameStory(s.id, current);
          return (
            <li key={s.id} data-story={s.id} aria-current={here ? "page" : undefined}>
              <KeepState href={withParams(storyHref(pack, s.id), params)}>
                <StoryLink pack={pack} story={s.id}>
                  <span className="sn">{s.id}</span> <span className="st">{s.title || <span className="untitled">not built yet</span>}</span>
                </StoryLink>
              </KeepState>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
