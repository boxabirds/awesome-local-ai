import { countsQuery, tasksQuery } from '@/features/tasks/queries';
import { queryClient } from '@/lib/queryClient';

export type WorkspaceLoaderArgs = { params: { workspaceId?: string } };

/**
 * Starts the Inbox list and the counts together and returns at once (no await, so no waterfall
 * and rendering is never blocked): the view renders its skeletons while both are in flight.
 * Runs on entry to a workspace, as soon as its id is known (see main.tsx and routes/Workspace.tsx).
 */
export function workspaceLoader({ params }: WorkspaceLoaderArgs): null {
  const { workspaceId } = params;
  if (!workspaceId) return null;
  void queryClient.prefetchQuery(tasksQuery(workspaceId, 'inbox'));
  void queryClient.prefetchQuery(countsQuery(workspaceId));
  return null;
}
