import { useSyncExternalStore, type ReactNode } from "react";
import { groupRuns, RUN_GROUPS, type RunGroup, type RunGroupId, type RunSection } from "../../shared/runGroups.ts";
import type { Row } from "../../shared/types.ts";

// Which sections are folded away: one choice per page kind (the combination pages, the story pages, the run pages,
// the story-run pages), remembered in the browser. Folding Finished on one combination's page folds it on every
// combination's page and nowhere else. Those that ended without finishing start folded everywhere: they are the
// cancelled and failed runs, which a reader looking for results does not want first.
export type FoldScope = "combination" | "story" | "run" | "storyRun";
const KEY = "benchmarker:folded-run-groups:v2";
const FOLDED_AT_FIRST: RunGroupId[] = ["ended"];
type Folded = Record<FoldScope, Set<RunGroupId>>;
const SCOPES: FoldScope[] = ["combination", "story", "run", "storyRun"];

function load(): Folded {
  const at = (ids: unknown) => new Set(RUN_GROUPS.map((g) => g.id).filter((id) => Array.isArray(ids) && ids.includes(id)));
  let saved: Partial<Record<FoldScope, unknown>> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<FoldScope, unknown>>; } catch { /* nothing remembered */ }
  return Object.fromEntries(SCOPES.map((s) => [s, s in saved ? at(saved[s]) : new Set(FOLDED_AT_FIRST)])) as Folded;
}

let folded = load();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function toggle(scope: FoldScope, id: RunGroupId) {
  const next = new Set(folded[scope]);
  if (next.has(id)) next.delete(id); else next.add(id);
  folded = { ...folded, [scope]: next };
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(SCOPES.map((s) => [s, [...folded[s]]])))); } catch { /* private window: not remembered */ }
  for (const fn of listeners) fn();
}

/** Whether this section is folded away on this page kind, and the way to change it; every section of that name on
 * that page kind moves together. */
export function useFolded(scope: FoldScope, id: RunGroupId): [boolean, () => void] {
  const isFolded = useSyncExternalStore(subscribe, () => folded[scope].has(id));
  return [isFolded, () => toggle(scope, id)];
}

/** The button that folds a section of runs; `count` is how many runs are in it. */
export function RunGroupButton({ scope, group, count }: { scope: FoldScope; group: RunGroup; count: number }) {
  const [isFolded, flip] = useFolded(scope, group.id);
  return (
    <button type="button" className="run-group-button" aria-expanded={!isFolded} onClick={flip}>
      <span className="fold" aria-hidden="true">{isFolded ? "▸" : "▾"}</span> {group.label} <span className="small">{count}</span>
    </button>
  );
}

/** A section's heading row inside a table. */
export function RunGroupRow({ scope, group, count, colSpan }: { scope: FoldScope; group: RunGroup; count: number; colSpan: number }) {
  return (
    <tr className="run-group-head" data-group={group.id}>
      <th scope="rowgroup" colSpan={colSpan}><RunGroupButton scope={scope} group={group} count={count} /></th>
    </tr>
  );
}

/** A section's heading and its rows, which fold away under it. With only one section on the page there is nothing to
 * tell apart: no heading, and the rows stay. */
export function RunSectionRows({ scope, group, count, colSpan, headed, children }: { scope: FoldScope; group: RunGroup; count: number; colSpan: number; headed: boolean; children: ReactNode }) {
  const [isFolded] = useFolded(scope, group.id);
  return <>{headed ? <RunGroupRow scope={scope} group={group} count={count} colSpan={colSpan} /> : null}{headed && isFolded ? null : children}</>;
}

/** The same for a list outside a table: the runs in sections, each under its folding heading, as a list of `render(run)`.
 * `runOf` finds the run an item holds. A page with a single section shows its list with no heading. */
export function RunSectionLists<T>({ scope, items, runOf, render, className }: { scope: FoldScope; items: T[]; runOf: (item: T) => Row; render: (item: T) => ReactNode; className?: string }) {
  const sections = groupRuns(items, runOf);
  return (
    <>
      {sections.map((s) => <FoldedList key={s.group.id} scope={scope} section={s} headed={sections.length > 1} render={render} className={className} />)}
    </>
  );
}

function FoldedList<T>({ scope, section, headed, render, className }: { scope: FoldScope; section: RunSection<T>; headed: boolean; render: (item: T) => ReactNode; className?: string }) {
  const [isFolded] = useFolded(scope, section.group.id);
  return (
    <div className="run-group-list" data-group={section.group.id}>
      {headed ? <h3><RunGroupButton scope={scope} group={section.group} count={section.items.length} /></h3> : null}
      {headed && isFolded ? null : <ul className={className}>{section.items.map(render)}</ul>}
    </div>
  );
}
