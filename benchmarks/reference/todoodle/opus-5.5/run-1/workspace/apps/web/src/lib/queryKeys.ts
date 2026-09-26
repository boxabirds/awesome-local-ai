/**
 * The one query-key factory (architecture §12). Every workspace-scoped key starts with root(id), so
 * invalidateQueries({ queryKey: queryKeys.root(id) }) reaches all of them. remembered() and
 * rememberedTouch(id) describe this browser's cookie, not one workspace, and are the only keys outside it.
 * Later stories extend this object.
 */
export const queryKeys = {
  root: (id: string) => ['ws', id] as const,
  workspace: (id: string) => ['ws', id, 'workspace'] as const,
  link: (id: string) => ['ws', id, 'link'] as const,
  /**
   * One task list: ['ws', id, 'tasks', {list, includeCompleted}] for the Inbox, and (story 7)
   * ['ws', id, 'tasks', {list: 'project', projectId, includeCompleted}] for a project. includeCompleted
   * defaults to false, so both spellings name the same cache entry. Without a filter, the prefix of every
   * list and variant (story 4 refetches all of them on tasks.bulk; story 6 writes optimistic changes to all).
   */
  tasks: ((id: string, filter?: TasksFilterInput) => (filter ? (['ws', id, 'tasks', normaliseFilter(filter)] as const) : (['ws', id, 'tasks'] as const))) as TasksKey,
  /** Open-task counts per list. No date in the key (story 8's queryFn reads the clock instead). */
  counts: (id: string) => ['ws', id, 'counts'] as const,
  /** Story 7: the workspace's active projects, in creation order. */
  projects: (id: string) => ['ws', id, 'projects'] as const,
  remembered: () => ['remembered'] as const,
  rememberedTouch: (id: string) => ['remembered-touch', id] as const,
};

/** Which list a task query holds (story 7): the Inbox (tasks with no project) or one project. */
export type ListScope = { list: 'inbox' } | { list: 'project'; projectId: string };

/** Which tasks a list query holds: one list's open tasks, plus its completed ones when includeCompleted. */
export type TasksFilter = ListScope & { includeCompleted: boolean };
export type TasksFilterInput = ListScope & { includeCompleted?: boolean };

export const INBOX_SCOPE: ListScope = { list: 'inbox' };

function normaliseFilter(filter: TasksFilterInput): TasksFilter {
  const includeCompleted = filter.includeCompleted ?? false;
  return filter.list === 'project' ? { list: 'project', projectId: filter.projectId, includeCompleted } : { list: filter.list, includeCompleted };
}

/** The list scope of a filter (drops includeCompleted). */
export function scopeOf(filter: ListScope): ListScope {
  return filter.list === 'project' ? { list: 'project', projectId: filter.projectId } : INBOX_SCOPE;
}

/** Whether a list with this scope holds a task in this project (null = Inbox). */
export function scopeHolds(scope: ListScope, projectId: string | null | undefined): boolean {
  return scope.list === 'project' ? projectId === scope.projectId : (projectId ?? null) === null;
}

/** The scope a task with this project belongs to. */
export function scopeFor(projectId: string | null | undefined): ListScope {
  return projectId ? { list: 'project', projectId } : INBOX_SCOPE;
}

/** A stable string for a scope ('inbox' or 'project:<id>'): the sidebar's view name and storage key part. */
export function scopeKey(scope: ListScope): string {
  return scope.list === 'project' ? `project:${scope.projectId}` : 'inbox';
}

type TasksKey = {
  (id: string): readonly ['ws', string, 'tasks'];
  (id: string, filter: TasksFilterInput): readonly ['ws', string, 'tasks', TasksFilter];
};
