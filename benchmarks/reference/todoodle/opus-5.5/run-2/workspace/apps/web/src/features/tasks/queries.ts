import type { Counts, TaskList } from '@todoodle/shared/schemas';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { getCounts, listTasks } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import type { LocalTask } from './localTask';
import { mergeLocalRows } from './taskCache';

/** Live updates and the reconnect refetch keep lists current; this only skips a refetch right after the loader's. */
const TASKS_STALE_MS = 10_000;

/**
 * Query options for one task list (with its completed tasks when `includeCompleted`). Background
 * refetches and toggling "Show completed" keep showing the previous rows (keepPreviousData: no
 * empty or loading flash), and this tab's unsaved rows are kept (their text is never lost).
 */
export function tasksQuery(workspaceId: string, list: TaskList, includeCompleted = false) {
  return queryOptions({
    queryKey: qk.tasks(workspaceId, { list, includeCompleted }),
    queryFn: async ({ signal, client, queryKey }): Promise<LocalTask[]> =>
      mergeLocalRows(await listTasks(workspaceId, { list, includeCompleted }, signal), client.getQueryData<LocalTask[]>(queryKey)),
    placeholderData: keepPreviousData,
    staleTime: TASKS_STALE_MS,
    // A failure shows "Couldn't load your tasks." with Try again at once.
    retry: false,
  });
}

/** Query options for the open-task counts (no date in the key; architecture section 12). */
export function countsQuery(workspaceId: string) {
  return queryOptions({
    queryKey: qk.counts(workspaceId),
    queryFn: ({ signal }): Promise<Counts> => getCounts(workspaceId, signal),
    staleTime: TASKS_STALE_MS,
    retry: false,
  });
}
