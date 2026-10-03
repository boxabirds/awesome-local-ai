// Runs that collapse: a stretch of stories in a row where no held-out test passes. Such a run's short thinking, short time
// and low cost are a broken run's, not a thrifty one's, so its stretch is marked (the owner, 3 Oct 2026) and the analyses
// leave it out of what they call efficient. One definition, here: the server puts it on each story, the scripts read it.
import type { Story } from "./types.ts";

/** Stories in a row that pass none for a run to have collapsed there. */
export const COLLAPSE_RUN = 3;

/** A story run passes none when it has own held-out tests and none passed. One with no tests recorded passes nothing
 * either way and breaks a stretch: it is not known to have failed. */
const passesNone = (s: Pick<Story, "ownPassed" | "ownTotal">) => s.ownTotal !== null && s.ownTotal > 0 && s.ownPassed === 0;

/** The ids of the stories in a collapsed stretch: COLLAPSE_RUN or more consecutive stories (in the run's own order of
 * stories, whatever numbers are missing from its scope) that pass none. */
export function collapsedStoryIds(stories: Pick<Story, "id" | "ownPassed" | "ownTotal">[]): Set<string> {
  const ordered = stories.toSorted((a, b) => Number(a.id) - Number(b.id));
  const out = new Set<string>();
  let stretch: string[] = [];
  const close = () => {
    if (stretch.length >= COLLAPSE_RUN) for (const id of stretch) out.add(id);
    stretch = [];
  };
  for (const s of ordered) {
    if (passesNone(s)) stretch.push(s.id);
    else close();
  }
  close();
  return out;
}
