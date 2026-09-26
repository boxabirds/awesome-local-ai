import type { QueryClient } from '@tanstack/react-query';
import { projectsQuery } from '@/features/projects/queries';
import { countsQuery, tasksQuery } from '@/features/tasks/queries';
import { browserStorage, readShowCompleted } from '@/features/tasks/showCompletedPref';
import { queryClient as appQueryClient } from '@/lib/queryClient';

/**
 * Starts the Inbox list (story 7: or the routed project's list), the counts and the projects together as soon as the workspace id is known, and does NOT wait
 * for them (async-parallel, no waterfall): rendering starts at once with skeletons while both requests
 * are in flight. Shaped like a React Router loader ({params} -> null).
 *
 * The app uses the declarative router, so there is no route `loader` hook: it is called wherever a
 * workspace id first becomes known (boot on /w/:id, open by link resolving, Home's prefetch on
 * hover/focus, and the workspace route itself).
 */
export function workspaceLoader(
  { params }: { params: { workspaceId?: string; projectId?: string } },
  queryClient: QueryClient = appQueryClient,
): null {
  const workspaceId = params.workspaceId;
  if (!workspaceId) return null;
  // The list's variant this browser shows (story 6: completed tasks too, when 'Show completed' is remembered on).
  const { projectId } = params;
  if (projectId) {
    const scope = { list: 'project', projectId } as const;
    void queryClient.prefetchQuery(tasksQuery(workspaceId, scope, readShowCompleted(browserStorage(), workspaceId, `project:${projectId}`)));
  } else {
    void queryClient.prefetchQuery(tasksQuery(workspaceId, 'inbox', readShowCompleted(browserStorage(), workspaceId, 'inbox')));
  }
  void queryClient.prefetchQuery(countsQuery(workspaceId));
  // Story 7: the sidebar's projects, in parallel with the list and counts (not gated on either).
  void queryClient.prefetchQuery(projectsQuery(workspaceId));
  return null;
}
