// Every page's address: one builder per entity, and the parser that reads an address back. The page keeps them
// in the URL's hash (#/vidi/r/…), so the server serves one file and every page can be bookmarked, shared and gone
// back to. Entity addresses start with their pack (a run id like "run-1" exists in more than one pack), except a
// machine's, which runs every pack (#/m/<machine>). Ids are encoded per segment: a combination's id holds slashes
// ("qwen/3.8/…/gufo-pi"), so it is one segment. A page's own state (the metric shown, the run compared with)
// rides along as query parameters (…?metric=calls), so it is in the address too.

type Params = Record<string, string>;

export type Route =
  | { page: "overview"; params: Params }
  | { page: "combination"; pack: string; stack: string; params: Params }
  | { page: "run"; pack: string; stack: string; runId: string; params: Params }
  | { page: "storyRun"; pack: string; stack: string; runId: string; story: string; params: Params }
  | { page: "conversation"; pack: string; stack: string; runId: string; story: string; params: Params }
  | { page: "call"; pack: string; stack: string; runId: string; story: string; call: string; params: Params }
  | { page: "story"; pack: string; story: string; params: Params }
  | { page: "machine"; machine: string; params: Params }
  | { page: "notFound"; path: string };

const seg = encodeURIComponent;
const storyNo = (story: string) => seg(String(Number(story)));
const MACHINE = "m";

export const overviewHref = () => "#/";
export const combinationHref = (pack: string, stack: string) => `#/${seg(pack)}/c/${seg(stack)}`;
export const runHref = (pack: string, stack: string, runId: string) => `#/${seg(pack)}/r/${seg(stack)}/${seg(runId)}`;
export const storyRunHref = (pack: string, stack: string, runId: string, story: string) =>
  `${runHref(pack, stack, runId)}/s/${storyNo(story)}`;
const CONVERSATION = "conversation";
const CALL = "c";
/** A story run's conversation, showing one kind of turn alone (`kind`) when asked: what a time bar's part names. */
export const conversationHref = (pack: string, stack: string, runId: string, story: string, kind?: string) =>
  withParams(`${storyRunHref(pack, stack, runId, story)}/${CONVERSATION}`, { kind });
/** One model call of a story run's conversation, in full. */
export const callHref = (pack: string, stack: string, runId: string, story: string, call: number | string) =>
  `${storyRunHref(pack, stack, runId, story)}/${CONVERSATION}/${CALL}/${seg(String(Number(call)))}`;
export const storyHref = (pack: string, story: string) => `#/${seg(pack)}/s/${storyNo(story)}`;
export const machineHref = (machine: string) => `#/${MACHINE}/${seg(machine)}`;

/** An address with page state added; empty values are left out. */
export function withParams(href: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return q ? `${href}?${q}` : href;
}

const STORY = /^\d+$/;

/** The page an address names. Anything that isn't one is notFound, never a guess. */
export function parseRoute(hash: string): Route {
  const [rawPath, query = ""] = hash.replace(/^#/, "").split("?", 2);
  const params = Object.fromEntries(new URLSearchParams(query));
  const path = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "") return { page: "overview", params };
  let parts: string[];
  try {
    parts = path.split("/").map(decodeURIComponent);
  } catch {
    return { page: "notFound", path };
  }
  if (parts.some((p) => p === "")) return { page: "notFound", path };
  if (parts[0] === MACHINE) return parts.length === 2 ? { page: "machine", machine: parts[1], params } : { page: "notFound", path };
  const [pack, kind, ...rest] = parts;
  if (kind === "c" && rest.length === 1) return { page: "combination", pack, stack: rest[0], params };
  if (kind === "s" && rest.length === 1 && STORY.test(rest[0])) return { page: "story", pack, story: String(Number(rest[0])), params };
  if (kind === "r" && rest.length === 2) return { page: "run", pack, stack: rest[0], runId: rest[1], params };
  if (kind === "r" && rest.length === 4 && rest[2] === "s" && STORY.test(rest[3])) {
    return { page: "storyRun", pack, stack: rest[0], runId: rest[1], story: String(Number(rest[3])), params };
  }
  if (kind === "r" && rest.length === 5 && rest[2] === "s" && STORY.test(rest[3]) && rest[4] === CONVERSATION) {
    return { page: "conversation", pack, stack: rest[0], runId: rest[1], story: String(Number(rest[3])), params };
  }
  if (kind === "r" && rest.length === 7 && rest[2] === "s" && STORY.test(rest[3]) && rest[4] === CONVERSATION && rest[5] === CALL && STORY.test(rest[6])) {
    return { page: "call", pack, stack: rest[0], runId: rest[1], story: String(Number(rest[3])), call: String(Number(rest[6])), params };
  }
  return { page: "notFound", path };
}
