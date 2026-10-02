import { combinationHref, machineHref, runHref, storyHref } from "./routes.ts";
import { storyList } from "./storyView.ts";
import type { Machine, Row, State } from "./types.ts";

/** The app's own information architecture, in the order results are grouped and shown. */
export type SearchSectionName = "Combinations" | "Runs" | "Stories" | "Machines";
const SECTION_ORDER: SearchSectionName[] = ["Combinations", "Runs", "Stories", "Machines"];

/** One searchable thing: its display title, a line of context (pack, machine, status…), and where it goes. */
export interface SearchItem {
  section: SearchSectionName;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

function combinationItems(rows: Row[]): SearchItem[] {
  const seen = new Set<string>();
  const items: SearchItem[] = [];
  for (const r of rows) {
    const key = `${r.pack}\u0000${r.stack}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ section: "Combinations", id: key, title: r.label || r.stack, subtitle: `${r.pack} · ${r.stack}`, href: combinationHref(r.pack, r.stack) });
  }
  return items;
}

function runItems(rows: Row[]): SearchItem[] {
  return rows.map((r) => ({
    section: "Runs",
    id: `${r.pack}\u0000${r.stack}\u0000${r.runId}`,
    title: r.runId,
    subtitle: `${r.label || r.stack} · ${r.machine}${r.host ? ` (${r.host})` : ""}`,
    href: runHref(r.pack, r.stack, r.runId),
  }));
}

/** One entry per distinct story id within a pack (story ids are only unique inside their own pack). */
function storyItems(rows: Row[]): SearchItem[] {
  const byPack = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byPack.get(r.pack);
    if (list) list.push(r); else byPack.set(r.pack, [r]);
  }
  const items: SearchItem[] = [];
  for (const [pack, packRows] of byPack) {
    for (const s of storyList(packRows)) {
      if (!s.title) continue;
      items.push({ section: "Stories", id: `${pack}\u0000${s.id}`, title: s.title, subtitle: `${pack} · story ${s.id}`, href: storyHref(pack, s.id) });
    }
  }
  return items;
}

function machineItems(machines: Machine[]): SearchItem[] {
  return machines.map((m) => ({
    section: "Machines",
    id: m.node,
    title: m.node,
    subtitle: m.running ? `running ${m.running.stack}` : m.busy ? "busy with an unlisted run" : m.queued ? `${m.queued} job${m.queued === 1 ? "" : "s"} queued` : "idle",
    href: machineHref(m.node),
  }));
}

/** Every combination, run, story and machine, regardless of the pack or version currently chosen on screen: search
 * finds things outside the current view, which is the point of it. */
export function buildSearchIndex(state: Pick<State, "rows" | "machines">): SearchItem[] {
  return [...combinationItems(state.rows), ...runItems(state.rows), ...storyItems(state.rows), ...machineItems(state.machines)];
}

export interface SearchMatch {
  item: SearchItem;
  score: number;
  /** Character ranges [from, to) to bold, found case-insensitively; sorted, may overlap for repeated tokens. */
  titleMarks: [number, number][];
  subtitleMarks: [number, number][];
}
export interface SearchGroup { section: SearchSectionName; matches: SearchMatch[] }

function markRanges(haystack: string, tokens: string[]): [number, number][] {
  const lower = haystack.toLowerCase();
  const ranges: [number, number][] = [];
  for (const t of tokens) {
    let from = 0;
    for (let i = lower.indexOf(t, from); i >= 0; i = lower.indexOf(t, from)) {
      ranges.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  return ranges.toSorted((a, b) => a[0] - b[0]);
}

const TITLE_WEIGHT = 12;
const SUBTITLE_WEIGHT = 1;
export const DEFAULT_PER_SECTION = 6;

/** Every token must appear in the title or the subtitle (a plain substring match, not fuzzy). Title hits outrank
 * subtitle-only hits, same as the guide's search. Results are grouped by section in information-architecture
 * order, and ranked by score inside each section. */
export function searchIndex(index: SearchItem[], query: string, perSection = DEFAULT_PER_SECTION): SearchGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const matches: SearchMatch[] = [];
  for (const item of index) {
    const lt = item.title.toLowerCase();
    const ls = item.subtitle.toLowerCase();
    let score = 0;
    let everyTokenFound = true;
    for (const t of tokens) {
      const inTitle = lt.includes(t), inSubtitle = ls.includes(t);
      if (!inTitle && !inSubtitle) { everyTokenFound = false; break; }
      score += (inTitle ? TITLE_WEIGHT : 0) + (inSubtitle ? SUBTITLE_WEIGHT : 0);
    }
    if (!everyTokenFound) continue;
    matches.push({ item, score, titleMarks: markRanges(item.title, tokens), subtitleMarks: markRanges(item.subtitle, tokens) });
  }
  const bySection = new Map<SearchSectionName, SearchMatch[]>();
  for (const m of matches) {
    const list = bySection.get(m.item.section);
    if (list) list.push(m); else bySection.set(m.item.section, [m]);
  }
  const groups: SearchGroup[] = [];
  for (const section of SECTION_ORDER) {
    const list = bySection.get(section);
    if (!list?.length) continue;
    list.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    groups.push({ section, matches: list.slice(0, perSection) });
  }
  return groups;
}
