import type { QueryClient } from '@tanstack/react-query';
import { workspaceQuery } from '@/features/workspace/workspaceQuery';
import { loadWorkspaceRoute } from '@/routes/lazy';
import { workspaceLoader } from '@/routes/workspaceLoader';

/** Warms everything opening /w/:id needs: the Workspace route chunk, the workspace data and its Inbox. */
export function prefetchWorkspace(queryClient: QueryClient, id: string): void {
  void loadWorkspaceRoute();
  void queryClient.prefetchQuery(workspaceQuery(id));
  workspaceLoader({ params: { workspaceId: id } }, queryClient);
}
