// Every page's address: one builder per entity, and the parser that reads an address back. The page keeps them
// in the URL's hash (#/vidi/r/…), so the server serves one file and every page can be bookmarked, shared and gone
// back to. Every entity address starts with its pack: a run id like "run-1" exists in more than one pack.
// Ids are encoded per segment: a combination's id holds slashes ("qwen/3.8/…/gufo-pi"), so it is one segment.

export type Route =
  | { page: "overview" }
  | { page: "combination"; pack: string; stack: string }
  | { page: "run"; pack: string; stack: string; runId: string }
  | { page: "storyRun"; pack: string; stack: string; runId: string; story: string }
  | { page: "notFound"; path: string };

const seg = encodeURIComponent;

export const overviewHref = () => "#/";
export const combinationHref = (pack: string, stack: string) => `#/${seg(pack)}/c/${seg(stack)}`;
export const runHref = (pack: string, stack: string, runId: string) => `#/${seg(pack)}/r/${seg(stack)}/${seg(runId)}`;
export const storyRunHref = (pack: string, stack: string, runId: string, story: string) =>
  `${runHref(pack, stack, runId)}/s/${seg(String(Number(story)))}`;

const STORY = /^\d+$/;

/** The page an address names. Anything that isn't one is notFound, never a guess. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "") return { page: "overview" };
  let parts: string[];
  try {
    parts = path.split("/").map(decodeURIComponent);
  } catch {
    return { page: "notFound", path };
  }
  if (parts.some((p) => p === "")) return { page: "notFound", path };
  const [pack, kind, ...rest] = parts;
  if (kind === "c" && rest.length === 1) return { page: "combination", pack, stack: rest[0] };
  if (kind === "r" && rest.length === 2) return { page: "run", pack, stack: rest[0], runId: rest[1] };
  if (kind === "r" && rest.length === 4 && rest[2] === "s" && STORY.test(rest[3])) {
    return { page: "storyRun", pack, stack: rest[0], runId: rest[1], story: String(Number(rest[3])) };
  }
  return { page: "notFound", path };
}
