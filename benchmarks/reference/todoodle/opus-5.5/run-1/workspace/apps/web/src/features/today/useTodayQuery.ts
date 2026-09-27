import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { getToday } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** The Today view for one local date. A date change keeps the previous rows on screen until the new ones load. */
export function todayQuery(workspaceId: string, date: string, includeCompleted = false) {
  return queryOptions({
    queryKey: queryKeys.today(workspaceId, { date, includeCompleted }),
    queryFn: () => getToday(workspaceId, { date, includeCompleted }),
    placeholderData: keepPreviousData,
  });
}

/** Today for the viewer's current local date (the caller passes useLocalDate(), so midnight changes the key). */
export function useTodayQuery(workspaceId: string, date: string, includeCompleted = false) {
  return useQuery(todayQuery(workspaceId, date, includeCompleted));
}
