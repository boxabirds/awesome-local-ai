import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { getLocalDateSnapshot } from '@/features/dates/clockStore';
import { getCounts, listTasks } from '@/lib/api';
import { INBOX_SCOPE, type ListScope, queryKeys } from '@/lib/queryKeys';
import { type LocalTask, mergeLocalRows } from './taskCache';

/**
 * One task list. The fetched list keeps rows that exist only on this device (pending, failed or rejected
 * creates), so a refetch never drops text the user has not saved yet. Background refetches keep the old
 * rows on screen (keepPreviousData); only the first load shows skeletons. Story 6: includeCompleted adds the
 * list's completed tasks after the open ones, and toggling it keeps the current rows on screen until they load.
 * Story 7: the list is the Inbox ('inbox') or a project scope.
 */
export function tasksQuery(workspaceId: string, list: ListScope | 'inbox', includeCompleted = false) {
  const scope: ListScope = list === 'inbox' ? INBOX_SCOPE : list;
  const queryKey = queryKeys.tasks(workspaceId, { ...scope, includeCompleted });
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) =>
      mergeLocalRows(await listTasks(workspaceId, { ...scope, includeCompleted }), client.getQueryData<LocalTask[]>(queryKey)),
    placeholderData: keepPreviousData,
  });
}

/**
 * Open-task counts. The key has no date (architecture §12); story 8's queryFn sends the viewer's local date read
 * from the clock store at fetch time, which adds `today`. useClockInvalidation refetches it at local midnight.
 */
export function countsQuery(workspaceId: string) {
  return queryOptions({ queryKey: queryKeys.counts(workspaceId), queryFn: () => getCounts(workspaceId, getLocalDateSnapshot()) });
}
