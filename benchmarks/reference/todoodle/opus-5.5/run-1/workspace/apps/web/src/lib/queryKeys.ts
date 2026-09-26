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
  /** Story 4 refetches these on tasks.bulk; stories 5 and 8 add finer keys under them. */
  tasks: (id: string) => ['ws', id, 'tasks'] as const,
  counts: (id: string) => ['ws', id, 'counts'] as const,
  remembered: () => ['remembered'] as const,
  rememberedTouch: (id: string) => ['remembered-touch', id] as const,
};
