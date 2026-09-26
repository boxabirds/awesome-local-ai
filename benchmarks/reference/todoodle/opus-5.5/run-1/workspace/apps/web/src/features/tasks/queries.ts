import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { TaskList } from '@todoodle/shared/schemas';
import { getCounts, listTasks } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { type LocalTask, mergeLocalRows } from './taskCache';

/**
 * One task list. The fetched list keeps rows that exist only on this device (pending, failed or rejected
 * creates), so a refetch never drops text the user has not saved yet. Background refetches keep the old
 * rows on screen (keepPreviousData); only the first load shows skeletons.
 */
export function tasksQuery(workspaceId: string, list: TaskList) {
  const queryKey = queryKeys.tasks(workspaceId, { list });
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) => mergeLocalRows(await listTasks(workspaceId, list), client.getQueryData<LocalTask[]>(queryKey)),
    placeholderData: keepPreviousData,
  });
}

export function countsQuery(workspaceId: string) {
  return queryOptions({ queryKey: queryKeys.counts(workspaceId), queryFn: () => getCounts(workspaceId) });
}
