import type { Row, State } from "../../shared/types.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";

/** One story: every combination's attempt at it. (Being built: plan section 4.5.) */
export function StoryPage({ pack, story, runs }: { pack: string; story: string; runs: Row[]; state: State; serverNow: number | null; params: Record<string, string> }) {
  const title = runs.flatMap((r) => r.stories).find((s) => s.id === story)?.title ?? "";
  return (
    <div className="page story-page" data-page="story">
      <Breadcrumb trail={[{ label: `${pack} story ${story}` }]} />
      <h1>Story {story}{title ? `: ${title}` : ""}</h1>
    </div>
  );
}
