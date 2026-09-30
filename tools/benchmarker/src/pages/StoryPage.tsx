// One story: how every stack does on it (plan section 4.5). The stories down the side; the story's header; every
// combination's median and range with its runs beneath; where the time went, on one scale. One story run can be the
// comparison (?compare=<combination>|<run>), kept in the address and carried to the other stories.
import type { Row, State } from "../../shared/types.ts";
import { comparisonOf, heldOutTests, sameStory, storyList, storyNeighbours, storyPage } from "../../shared/storyView.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { useAddressParam } from "../components/story/useAddressParam.ts";
import { StoryList } from "../components/story/StoryList.tsx";
import { StoryHeader } from "../components/story/StoryHeader.tsx";
import { ByCombination } from "../components/story/ByCombination.tsx";
import { StoryTime } from "../components/story/StoryTime.tsx";
import "./story.css";

export function StoryPage({ pack, story, runs, params }: { pack: string; story: string; runs: Row[]; state: State; serverNow: number | null; params: Record<string, string> }) {
  const [compare, setCompare] = useAddressParam(params, "compare");
  const list = storyList(runs);
  const item = list.find((s) => sameStory(s.id, story)) ?? null;
  const { prev, next } = storyNeighbours(list, story);
  const view = storyPage(runs, story);
  const cmp = comparisonOf(view, compare, story);
  const state = { compare };
  return (
    <div className="page story-page" data-page="story" data-story={story}>
      <Breadcrumb trail={[{ label: `${pack} story ${story}` }]} />
      <div className="sp-layout">
        <StoryList pack={pack} stories={list} current={story} params={state} />
        <div className="sp-main">
          <StoryHeader pack={pack} family={runs[0]?.family ?? ""} id={story} title={item?.title ?? ""} known={item !== null}
            tests={heldOutTests(runs, story)} prev={prev} next={next} view={view} params={state} />
          <ByCombination view={view} storyId={story} cmp={cmp} onCompare={setCompare} />
          <StoryTime view={view} storyId={story} />
        </div>
      </div>
    </div>
  );
}
