import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Counts, Project, TodayResponse, TodayTask } from '@todoodle/shared/schemas';
import { getLocalDateSnapshot } from '@/features/dates/clockStore';
import type { LocalTask } from '@/features/tasks/taskCache';
import { type TodayParams, queryKeys } from '@/lib/queryKeys';

// Pure, immutable helpers for the Today cache ({date, overdue, today, completed}), and the mirror that keeps it in
// step with story 6/7's task actions (complete, reopen, edit, delete, move, undo) so a change made anywhere shows
// in Today at once. Untouched rows keep their references (TaskRow's memo relies on it).

/** A row of the Today cache: a Today task, possibly mid-completion (story 6's leaving animation). */
export type TodayRow = TodayTask & { leaving?: boolean; localStatus?: LocalTask['localStatus'] };
export type TodayData = Omit<TodayResponse, 'overdue' | 'today' | 'completed'> & { overdue: TodayRow[]; today: TodayRow[]; completed: TodayRow[] };

/** Where a row belongs on the Today of `date` (a completing, still-leaving row stays in its open group). */
function groupOf(row: TodayRow, date: string): 'overdue' | 'today' | 'completed' | null {
  if (row.dueDate === null || row.dueDate > date) return null;
  const open = row.completedAt === null || row.leaving === true;
  if (!open) return row.dueDate === date ? 'completed' : null;
  return row.dueDate < date ? 'overdue' : 'today';
}

const byOverdue = (a: TodayRow, b: TodayRow) =>
  a.dueDate! !== b.dueDate! ? (a.dueDate! < b.dueDate! ? -1 : 1) : a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id < b.id ? -1 : 1;
const byToday = (a: TodayRow, b: TodayRow) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id < b.id ? -1 : 1);
const byCompleted = (a: TodayRow, b: TodayRow) =>
  a.completedAt! !== b.completedAt! ? (a.completedAt! < b.completedAt! ? 1 : -1) : a.id < b.id ? -1 : 1;

/**
 * Applies many row changes at once: `changes` maps an id to its new row, or to null when it leaves Today (deleted).
 * Each changed row is removed and re-placed in the group its date and state put it in (or nowhere). Only the groups
 * something was added to are re-sorted. The same object comes back when nothing changed.
 */
export function applyTodayChanges(data: TodayData | undefined, changes: ReadonlyMap<string, TodayRow | null>): TodayData | undefined {
  if (!data || changes.size === 0) return data;
  const groups = { overdue: data.overdue, today: data.today, completed: data.completed };
  const added = { overdue: [] as TodayRow[], today: [] as TodayRow[], completed: [] as TodayRow[] };
  let changed = false;
  for (const name of ['overdue', 'today', 'completed'] as const) {
    const kept = groups[name].filter((row) => !changes.has(row.id));
    if (kept.length !== groups[name].length) {
      groups[name] = kept;
      changed = true;
    }
  }
  for (const row of changes.values()) {
    if (!row) continue;
    const group = groupOf(row, data.date);
    if (group) added[group].push(row);
  }
  const sorters = { overdue: byOverdue, today: byToday, completed: byCompleted };
  for (const name of ['overdue', 'today', 'completed'] as const) {
    if (added[name].length === 0) continue;
    groups[name] = [...groups[name], ...added[name]].sort(sorters[name]);
    changed = true;
  }
  return changed ? { ...data, ...groups } : data;
}

/** Finds a row in a Today cache. */
export function findTodayRow(data: TodayData | undefined, id: string): TodayRow | undefined {
  if (!data) return undefined;
  return data.overdue.find((row) => row.id === id) ?? data.today.find((row) => row.id === id) ?? data.completed.find((row) => row.id === id);
}

/** Every cached Today of a workspace (each date and 'Show completed' variant). */
export function todayCaches(queryClient: QueryClient, workspaceId: string): Array<[QueryKey, TodayData | undefined]> {
  return queryClient.getQueriesData<TodayData>({ queryKey: queryKeys.today(workspaceId) });
}

/**
 * Whether a task counts towards the Today badge on `date`: saved (not a pending or failed create), open (not even
 * mid-completion) and due by then.
 */
export function countsTowardsToday(task: Pick<TodayRow, 'dueDate' | 'completedAt' | 'localStatus'> | null | undefined, date: string): boolean {
  return !!task && task.localStatus === undefined && task.completedAt === null && task.dueDate !== null && task.dueDate <= date;
}

/** Adds `delta` to the Today count (never below zero); counts without `today` stay as they are. */
export function adjustTodayCount(counts: Counts | undefined, delta: number): Counts | undefined {
  if (!counts || counts.today === undefined || delta === 0) return counts;
  return { ...counts, today: Math.max(0, counts.today + delta) };
}

/** A task as a Today row: its project's name and colour come from the row it replaces, or the projects cache. */
function toTodayRow(queryClient: QueryClient, workspaceId: string, task: LocalTask, previous: TodayRow | undefined): TodayRow {
  const projectId = task.projectId ?? null;
  if (previous && (previous.projectId ?? null) === projectId) {
    return { ...task, projectId, projectName: previous.projectName, projectColor: previous.projectColor };
  }
  const project = projectId ? queryClient.getQueryData<Project[]>(queryKeys.projects(workspaceId))?.find((item) => item.id === projectId) : undefined;
  return { ...task, projectId, projectName: project?.name ?? null, projectColor: project?.color ?? null };
}

/**
 * The mirror behind the task actions (useTaskMutations): writes a task's new state into every cached Today of the
 * workspace (null: it left, e.g. deleted) and moves the Today count by the difference it makes. `previous` is the
 * task before the change, so the count delta is exact; a rollback is the same call with the two swapped.
 */
export function mirrorTaskToToday(queryClient: QueryClient, workspaceId: string, id: string, next: LocalTask | null, previous: LocalTask | null): void {
  for (const [key, data] of todayCaches(queryClient, workspaceId)) {
    const cached = findTodayRow(data, id);
    const row = next ? toTodayRow(queryClient, workspaceId, next, cached) : null;
    const updated = applyTodayChanges(data, new Map([[id, row]]));
    if (updated !== data) queryClient.setQueryData(key, updated);
  }
  const date = getLocalDateSnapshot();
  const delta = Number(countsTowardsToday(next, date)) - Number(countsTowardsToday(previous, date));
  if (delta !== 0) queryClient.setQueryData<Counts>(queryKeys.counts(workspaceId), (counts) => adjustTodayCount(counts, delta));
}

/** A task from any cached Today (when no task list has it). */
export function findInTodayCaches(queryClient: QueryClient, workspaceId: string, id: string): TodayRow | undefined {
  for (const [, data] of todayCaches(queryClient, workspaceId)) {
    const row = findTodayRow(data, id);
    if (row) return row;
  }
  return undefined;
}

/** The key of one Today (re-exported for tests and the route). */
export function todayKey(workspaceId: string, params: TodayParams) {
  return queryKeys.today(workspaceId, params);
}
