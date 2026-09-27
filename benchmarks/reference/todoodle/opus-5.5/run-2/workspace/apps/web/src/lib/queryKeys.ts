import type { TaskList } from '@todoodle/shared/schemas';

/**
 * The one query-key factory (architecture section 12). Every workspace-scoped key starts with
 * root(id), so `invalidateQueries({ queryKey: queryKeys.root(id) })` reaches all of them.
 * remembered() and rememberedTouch(id) describe this browser's cookie, not one workspace, and
 * are the only keys outside the root. Later stories extend this object.
 */
export const queryKeys = {
  root: (id: string) => ['ws', id] as const,
  /** One task list (story 5: inbox; stories 7 and 8 add project and today). */
  tasks: (id: string, filter: { list: TaskList }) => ['ws', id, 'tasks', filter] as const,
  /** Open-task counts. No date in the key (architecture section 12): story 8's queryFn reads the clock. */
  counts: (id: string) => ['ws', id, 'counts'] as const,
  workspace: (id: string) => ['ws', id, 'workspace'] as const,
  link: (id: string) => ['ws', id, 'link'] as const,
  remembered: () => ['remembered'] as const,
  rememberedTouch: (id: string) => ['remembered-touch', id] as const,
};

/** Short name used by the task features (the design's `qk`). */
export const qk = queryKeys;
