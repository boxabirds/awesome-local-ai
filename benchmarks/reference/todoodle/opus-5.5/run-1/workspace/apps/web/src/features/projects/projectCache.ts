import type { Counts, Project, ProjectCounts } from '@todoodle/shared/schemas';

// Pure, immutable helpers for the projects cache and the sidebar counts (story 7). Each returns the SAME
// reference when nothing changed, and keeps the references of untouched items (ProjectRow's memo relies on it).

/** A live project change, as the handlers hand it over (entity validated, version from the event). */
export type ProjectCacheEvent =
  | { type: 'project.upserted' | 'project.restored'; project: Project; version: number }
  | { type: 'project.deleted'; id: string; version: number };

/** id -> index, built in one pass (js-index-maps). */
export function indexProjects(list: readonly Project[]): Map<string, number> {
  const index = new Map<string, number>();
  list.forEach((project, i) => index.set(project.id, i));
  return index;
}

/** Creation order: sortOrder, then createdAt, then id (the server's ORDER BY). */
function comesBefore(a: Project, b: Project): boolean {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

/** Inserts (or re-places) a project at its position in creation order. */
export function insertProject(list: readonly Project[] | undefined, project: Project): Project[] {
  const base = (list ?? []).filter((item) => item.id !== project.id);
  let index = base.length;
  while (index > 0 && comesBefore(project, base[index - 1]!)) index--;
  return base.toSpliced(index, 0, project);
}

/** Removes a project. */
export function removeProject(list: Project[] | undefined, id: string): Project[] | undefined {
  if (!list) return list;
  const index = indexProjects(list).get(id);
  return index === undefined ? list : list.toSpliced(index, 1);
}

/**
 * Applies one live project event to the cached list:
 * - an event whose version is not newer than the cached copy is ignored (stale or an echo already applied);
 * - upserted replaces the cached copy in place, or inserts a new project in creation order;
 * - deleted removes it;
 * - restored inserts it back at its creation-order position.
 * An uncached list (undefined) stays undefined: the next fetch brings the truth.
 */
export function applyProjectEvent(list: Project[] | undefined, event: ProjectCacheEvent): Project[] | undefined {
  if (!list) return list;
  const index = indexProjects(list).get(event.type === 'project.deleted' ? event.id : event.project.id);
  const cached = index === undefined ? undefined : list[index];
  if (cached && cached.version >= event.version) return list;
  if (event.type === 'project.deleted') return index === undefined ? list : list.toSpliced(index, 1);
  const project = { ...event.project, version: event.version };
  if (index !== undefined && cached!.sortOrder === project.sortOrder) return list.with(index, project);
  return insertProject(list, project);
}

/** A change to the sidebar counts. Missing fields change nothing. */
export type CountsDelta = {
  /** Open tasks in the Inbox. */
  inbox?: number;
  /** Per project: open and total (open + completed) task deltas. A project not in counts gets an entry. */
  projects?: Record<string, Partial<ProjectCounts>>;
  /** Projects whose entry leaves the counts (a deleted project). */
  remove?: readonly string[];
};

const clamp = (value: number) => Math.max(0, value);

/** Applies a delta to the counts; nothing ever goes below zero. */
export function adjustCounts<T extends Counts>(counts: T | undefined, delta: CountsDelta): T | undefined {
  if (!counts) return counts;
  let projects = counts.projects ?? {};
  let projectsChanged = false;
  for (const [id, change] of Object.entries(delta.projects ?? {})) {
    const current = projects[id] ?? { open: 0, total: 0 };
    const next = { open: clamp(current.open + (change.open ?? 0)), total: clamp(current.total + (change.total ?? 0)) };
    if (projects[id] && next.open === current.open && next.total === current.total) continue;
    projects = { ...projects, [id]: next };
    projectsChanged = true;
  }
  for (const id of delta.remove ?? []) {
    if (!(id in projects)) continue;
    const { [id]: _removed, ...rest } = projects;
    projects = rest;
    projectsChanged = true;
  }
  const inbox = clamp(counts.inbox + (delta.inbox ?? 0));
  if (inbox === counts.inbox && !projectsChanged) return counts;
  // Only the fields that changed are written, so a counts value without `projects` keeps its shape.
  return projectsChanged ? { ...counts, inbox, projects } : { ...counts, inbox };
}

type Countable = { completedAt: string | null; projectId: string | null };

/** The counts delta of `sign` tasks (1: added, -1: removed) in the task's list. The Inbox only counts open tasks. */
export function taskCountsDelta(task: Countable, sign: 1 | -1): CountsDelta {
  const open = task.completedAt === null ? sign : 0;
  return task.projectId ? { projects: { [task.projectId]: { open, total: sign } } } : { inbox: open };
}

/** The counts delta of moving a task from its list to `to` (null = Inbox). */
export function moveCountsDelta(task: Countable, to: string | null): CountsDelta {
  if ((task.projectId ?? null) === to) return {};
  return mergeDeltas(taskCountsDelta(task, -1), taskCountsDelta({ ...task, projectId: to }, 1));
}

/** Two deltas as one. */
export function mergeDeltas(a: CountsDelta, b: CountsDelta): CountsDelta {
  const projects: Record<string, Partial<ProjectCounts>> = { ...a.projects };
  for (const [id, change] of Object.entries(b.projects ?? {})) {
    const current = projects[id] ?? {};
    projects[id] = { open: (current.open ?? 0) + (change.open ?? 0), total: (current.total ?? 0) + (change.total ?? 0) };
  }
  return { inbox: (a.inbox ?? 0) + (b.inbox ?? 0), projects, remove: [...(a.remove ?? []), ...(b.remove ?? [])] };
}
