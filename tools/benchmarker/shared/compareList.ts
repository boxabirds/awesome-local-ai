// The runs a run page compares itself with: which can be chosen, how a choice is written in the address, how a typed
// search finds one, and how the list is read back. Pure, so the page's component stays a thin shell around it.
import type { Row } from "./types.ts";
import { runOrder } from "./runGroups.ts";

/** Separates a combination from a run id in a list entry; no combination path contains it. */
const STACK_SEPARATOR = "|";
const LIST_SEPARATOR = ",";
/** What the address says when the reader chose no run, as opposed to saying nothing (not chosen yet). */
export const NONE = "none";

/** One run, anywhere: run ids repeat across combinations, so the key is the combination and the id. */
export const runKey = (r: Pick<Row, "stack" | "runId">) => `${r.stack}${STACK_SEPARATOR}${r.runId}`;

/** The runs that can be compared with `run`: every other run in its pack and suite that has recorded a story, this
 * combination's first. The suite is part of it because a story id means the same story only within one suite. */
export function comparableRuns(run: Pick<Row, "pack" | "stack" | "runId" | "suite">, rows: Row[]): Row[] {
  const candidates = rows.filter((r) => r.pack === run.pack && r.suite === run.suite && r.stories.length > 0
    && !(r.stack === run.stack && r.runId === run.runId));
  const stacks = [...new Set(candidates.map((r) => r.stack))]
    .toSorted((a, b) => (a === run.stack ? -1 : b === run.stack ? 1 : a.localeCompare(b, "en")));
  return stacks.flatMap((stack) => runOrder(candidates.filter((r) => r.stack === stack)));
}

/** A run as the address names it: the bare run id for this combination's runs (so ?compare=v2-r4 keeps working), else
 * the combination and the id. */
export const compareToken = (run: Pick<Row, "stack">, other: Pick<Row, "stack" | "runId">) =>
  other.stack === run.stack ? other.runId : runKey(other);

export function parseCompareList(param: string | undefined): string[] {
  if (!param || param === NONE) return [];
  return [...new Set(param.split(LIST_SEPARATOR).map((t) => t.trim()).filter((t) => t && t !== NONE))];
}

export const serializeCompareList = (tokens: string[]) => (tokens.length ? tokens.join(LIST_SEPARATOR) : NONE);

/** The runs a list names, in its order; names that are not candidates (a run since removed, another suite) come back
 * in `unknown` so the page can say so rather than drop them silently. */
export function resolveCompareList(run: Pick<Row, "stack">, tokens: string[], candidates: Row[]): { runs: Row[]; unknown: string[] } {
  const runs: Row[] = [], unknown: string[] = [];
  for (const token of tokens) {
    const at = token.lastIndexOf(STACK_SEPARATOR);
    const stack = at < 0 ? run.stack : token.slice(0, at), runId = at < 0 ? token : token.slice(at + 1);
    const found = candidates.find((r) => r.stack === stack && r.runId === runId);
    if (found) runs.push(found); else unknown.push(token);
  }
  return { runs, unknown };
}

/** The candidates a search finds: every word must appear somewhere in the run's id, label, combination, machine or
 * status, in any order, ignoring case. An empty search offers everything. Runs already chosen are left out. */
export function matchRuns(candidates: Row[], query: string, chosen: ReadonlySet<string> = new Set()): Row[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return candidates.filter((r) => {
    if (chosen.has(runKey(r))) return false;
    const hay = [r.runId, r.label, r.stack, r.machine, r.status].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
