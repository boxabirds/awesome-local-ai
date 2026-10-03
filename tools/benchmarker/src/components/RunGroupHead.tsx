import { useSyncExternalStore, type ReactNode } from "react";
import { groupRuns, RUN_GROUPS, type RunGroup, type RunGroupId, type RunSection } from "../../shared/runGroups.ts";
import type { Row } from "../../shared/types.ts";

// Which sections are folded away, one choice for the whole app, remembered in the browser. Those that ended without
// finishing start folded: they are the cancelled and failed runs, which a reader looking for results does not want first.
const KEY = "benchmarker:folded-run-groups:v1";
const FOLDED_AT_FIRST: RunGroupId[] = ["ended"];

function load(): Set<RunGroupId> {
  try {
    const saved = localStorage.getItem(KEY);
    const ids = saved === null ? FOLDED_AT_FIRST : (JSON.parse(saved) as string[]);
    return new Set(RUN_GROUPS.map((g) => g.id).filter((id) => ids.includes(id)));
  } catch {
    return new Set(FOLDED_AT_FIRST);
  }
}

let folded = load();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function toggle(id: RunGroupId) {
  folded = new Set(folded);
  if (folded.has(id)) folded.delete(id); else folded.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...folded])); } catch { /* private window: not remembered */ }
  for (const fn of listeners) fn();
}

/** Whether this section is folded away, and the way to change it; every section of that name moves together. */
export function useFolded(id: RunGroupId): [boolean, () => void] {
  const isFolded = useSyncExternalStore(subscribe, () => folded.has(id));
  return [isFolded, () => toggle(id)];
}

/** The button that folds a section of runs; `count` is how many runs are in it. */
export function RunGroupButton({ group, count }: { group: RunGroup; count: number }) {
  const [isFolded, flip] = useFolded(group.id);
  return (
    <button type="button" className="run-group-button" aria-expanded={!isFolded} onClick={flip}>
      <span className="fold" aria-hidden="true">{isFolded ? "▸" : "▾"}</span> {group.label} <span className="small">{count}</span>
    </button>
  );
}

/** A section's heading row inside a table. */
export function RunGroupRow({ group, count, colSpan }: { group: RunGroup; count: number; colSpan: number }) {
  return (
    <tr className="run-group-head" data-group={group.id}>
      <th scope="rowgroup" colSpan={colSpan}><RunGroupButton group={group} count={count} /></th>
    </tr>
  );
}

/** A section's heading and its rows, which fold away under it. With only one section on the page there is nothing to
 * tell apart: no heading, and the rows stay. */
export function RunSectionRows({ group, count, colSpan, headed, children }: { group: RunGroup; count: number; colSpan: number; headed: boolean; children: ReactNode }) {
  const [isFolded] = useFolded(group.id);
  return <>{headed ? <RunGroupRow group={group} count={count} colSpan={colSpan} /> : null}{headed && isFolded ? null : children}</>;
}

/** The same for a list outside a table: the runs in sections, each under its folding heading, as a list of `render(run)`.
 * `runOf` finds the run an item holds. A page with a single section shows its list with no heading. */
export function RunSectionLists<T>({ items, runOf, render, className }: { items: T[]; runOf: (item: T) => Row; render: (item: T) => ReactNode; className?: string }) {
  const sections = groupRuns(items, runOf);
  return (
    <>
      {sections.map((s) => <FoldedList key={s.group.id} section={s} headed={sections.length > 1} render={render} className={className} />)}
    </>
  );
}

function FoldedList<T>({ section, headed, render, className }: { section: RunSection<T>; headed: boolean; render: (item: T) => ReactNode; className?: string }) {
  const [isFolded] = useFolded(section.group.id);
  return (
    <div className="run-group-list" data-group={section.group.id}>
      {headed ? <h3><RunGroupButton group={section.group} count={section.items.length} /></h3> : null}
      {headed && isFolded ? null : <ul className={className}>{section.items.map(render)}</ul>}
    </div>
  );
}
