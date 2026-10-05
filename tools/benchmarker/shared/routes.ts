// Every page's address: one builder per entity, and the parser that reads an address back. The page keeps them
// in the URL's hash (#/vidi/r/…), so the server serves one file and every page can be bookmarked, shared and gone
// back to. Every screen a reader can stand on has one: the four sections (#/ is the runs overview, #/machines,
// #/setup, #/<pack>/stories) as well as the entities under them. Entity addresses start with their pack (a run id
// like "run-1" exists in more than one pack), except a machine's, which runs every pack (#/machines/<machine>; the
// older #/m/<machine> still opens it). Ids are encoded per segment: a combination's id holds slashes
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
  | { page: "stories"; pack: string; params: Params }
  | { page: "story"; pack: string; story: string; params: Params }
  | { page: "machines"; params: Params }
  | { page: "machine"; machine: string; params: Params }
  | { page: "setup"; params: Params }
  | { page: "activity"; params: Params }
  | { page: "notFound"; path: string };

const seg = encodeURIComponent;
const storyNo = (story: string) => seg(String(Number(story)));
const MACHINES = "machines";
/** The machine pages' first address; kept so links made before the sections had addresses still open. */
const MACHINE_OLD = "m";
const SETUP = "setup";
const ACTIVITY = "activity";
const STORIES = "stories";

export const overviewHref = () => "#/";
export const machinesHref = () => `#/${MACHINES}`;
export const setupHref = () => `#/${SETUP}`;
export const activityHref = () => `#/${ACTIVITY}`;
export const storiesHref = (pack: string) => `#/${seg(pack)}/${STORIES}`;
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
export const machineHref = (machine: string) => `#/${MACHINES}/${seg(machine)}`;

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
  if (parts[0] === MACHINES && parts.length === 1) return { page: "machines", params };
  if (parts[0] === MACHINES || parts[0] === MACHINE_OLD) return parts.length === 2 ? { page: "machine", machine: parts[1], params } : { page: "notFound", path };
  if (parts[0] === SETUP) return parts.length === 1 ? { page: "setup", params } : { page: "notFound", path };
  if (parts[0] === ACTIVITY) return parts.length === 1 ? { page: "activity", params } : { page: "notFound", path };
  const [pack, kind, ...rest] = parts;
  if (kind === STORIES && rest.length === 0) return { page: "stories", pack, params };
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

/** The four sections of the site, one tab each. A page belongs to one; an address that names nothing to none. */
export type Section = "runs" | "stories" | "machines" | "setup" | "activity";

export function sectionOf(route: Route): Section | null {
  switch (route.page) {
    case "overview": case "combination": case "run": case "storyRun": case "conversation": case "call": return "runs";
    case "stories": case "story": return "stories";
    case "machines": case "machine": return "machines";
    case "setup": return "setup";
    case "activity": return "activity";
    case "notFound": return null;
  }
}

/** One crumb of a page's trail: its text, where it leads (none for the page itself), the link class and hover the
 * same entity gets everywhere else on the page. */
export interface Crumb { label: string; href?: string; cls?: string; tip?: string }

/** What the trail needs that the address doesn't carry: the combination's short label. */
export interface TrailNames { combination?: string; /** The story's title: the story crumb then reads "Story 3: Title". */ story?: string }

const OVERVIEW = "Overview";
const SECTION_NAMES: Record<Section, string> = { runs: OVERVIEW, stories: "Stories", machines: "Machines", setup: "Setup", activity: "Activity" };
const CONVERSATION_NAME = "Conversation";
const CALL_FROM = 1;
/** A run crumb's hover is its combination's id and its run id, as RunLink shows them. */
const RUN_TIP_SEP = " · ";
const storyLabel = (story: string, title?: string) => `Story ${Number(story)}${title ? `: ${title}` : ""}`;
/** The crumb for the page itself: the same entity, with nowhere to go. */
const here = ({ href: _, ...crumb }: Crumb): Crumb => crumb;

/** Where a page sits, from the overview down to the page itself (the last crumb, which has no link): one shape per
 * page kind. Runs: Overview › combination › run › Story N › Conversation › Call N. Stories: Overview › Stories ›
 * Story N. Machines: Overview › Machines › name. The overview and a page that names nothing have no trail. */
export function trailFor(route: Route, names: TrailNames): Crumb[] {
  const overview: Crumb = { label: OVERVIEW, href: overviewHref() };
  switch (route.page) {
    case "overview": case "notFound": return [];
    case "machines": return [overview, { label: SECTION_NAMES.machines }];
    case "setup": return [overview, { label: SECTION_NAMES.setup }];
    case "activity": return [overview, { label: SECTION_NAMES.activity }];
    case "stories": return [overview, { label: SECTION_NAMES.stories }];
    case "machine": return [overview, { label: SECTION_NAMES.machines, href: machinesHref() }, { label: route.machine, cls: "machine-link" }];
    case "story": return [overview, { label: SECTION_NAMES.stories, href: storiesHref(route.pack) }, { label: storyLabel(route.story, names.story), cls: "story-link" }];
    default: break;
  }
  const combination: Crumb = { label: names.combination ?? route.stack, href: combinationHref(route.pack, route.stack), cls: "combination-link", tip: route.stack };
  if (route.page === "combination") return [overview, here(combination)];
  const run: Crumb = { label: route.runId, href: runHref(route.pack, route.stack, route.runId), cls: "run-link", tip: `${route.stack}${RUN_TIP_SEP}${route.runId}` };
  if (route.page === "run") return [overview, combination, here(run)];
  const story: Crumb = { label: storyLabel(route.story, names.story), href: storyRunHref(route.pack, route.stack, route.runId, route.story), cls: "story-run-link" };
  if (route.page === "storyRun") return [overview, combination, run, here(story)];
  const conversation: Crumb = { label: CONVERSATION_NAME, href: conversationHref(route.pack, route.stack, route.runId, route.story), cls: "conversation-link" };
  if (route.page === "conversation") return [overview, combination, run, story, here(conversation)];
  return [overview, combination, run, story, conversation, { label: `Call ${Number(route.call) + CALL_FROM}` }];
}

const APP_NAME = "Benchmarker";
const TITLE_SEP = " · ";

/** The window's title: the trail nearest first, without the overview, then the app's name. */
export function titleFor(trail: Crumb[]): string {
  return [...trail.filter((c) => c.label !== OVERVIEW).map((c) => c.label).toReversed(), APP_NAME].join(TITLE_SEP);
}
