import type { TaskList } from '@todoodle/shared/schemas';

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
   * One task list: ['ws', id, 'tasks', {list}]. Without a filter, the prefix of every list (story 4
   * refetches all of them on tasks.bulk).
   */
  tasks: ((id: string, filter?: { list: TaskList }) =>
    filter ? (['ws', id, 'tasks', filter] as const) : (['ws', id, 'tasks'] as const)) as TasksKey,
  /** Open-task counts per list. No date in the key (story 8's queryFn reads the clock instead). */
  counts: (id: string) => ['ws', id, 'counts'] as const,
  remembered: () => ['remembered'] as const,
  rememberedTouch: (id: string) => ['remembered-touch', id] as const,
};

type TasksKey = {
  (id: string): readonly ['ws', string, 'tasks'];
  (id: string, filter: { list: TaskList }): readonly ['ws', string, 'tasks', { list: TaskList }];
};
