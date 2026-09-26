import type { QueryClient } from '@tanstack/react-query';
import { countsQuery, tasksQuery } from '@/features/tasks/queries';
import { queryClient as appQueryClient } from '@/lib/queryClient';

/**
 * Starts the Inbox list and the counts together as soon as the workspace id is known, and does NOT wait
 * for them (async-parallel, no waterfall): rendering starts at once with skeletons while both requests
 * are in flight. Shaped like a React Router loader ({params} -> null).
 *
 * The app uses the declarative router, so there is no route `loader` hook: it is called wherever a
 * workspace id first becomes known (boot on /w/:id, open by link resolving, Home's prefetch on
 * hover/focus, and the workspace route itself).
 */
export function workspaceLoader(
  { params }: { params: { workspaceId?: string } },
  queryClient: QueryClient = appQueryClient,
): null {
  const workspaceId = params.workspaceId;
  if (!workspaceId) return null;
  void queryClient.prefetchQuery(tasksQuery(workspaceId, 'inbox'));
  void queryClient.prefetchQuery(countsQuery(workspaceId));
  return null;
}
