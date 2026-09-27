import type { QueryClient } from '@tanstack/react-query';
import { getLocalDateSnapshot } from '@/features/dates/clockStore';
import { countsQuery } from '@/features/tasks/queries';
import { browserStorage, readShowCompleted } from '@/features/tasks/showCompletedPref';
import { todayQuery } from './useTodayQuery';

/** The key the Today view remembers 'Show completed' under. */
export const TODAY_LIST_KEY = 'today';

/**
 * Today's data for the viewer's local date and its count, in parallel (async-parallel): on entering the route and on
 * the sidebar entry's hover or focus. No-ops when fresh.
 */
export function prefetchToday(queryClient: QueryClient, workspaceId: string): Promise<unknown> {
  const includeCompleted = readShowCompleted(browserStorage(), workspaceId, TODAY_LIST_KEY);
  return Promise.all([
    queryClient.prefetchQuery(todayQuery(workspaceId, getLocalDateSnapshot(), includeCompleted)),
    queryClient.prefetchQuery(countsQuery(workspaceId)),
  ]);
}
