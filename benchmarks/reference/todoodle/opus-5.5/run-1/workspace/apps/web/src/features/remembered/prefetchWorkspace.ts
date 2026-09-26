import type { QueryClient } from '@tanstack/react-query';
import { workspaceQuery } from '@/features/workspace/workspaceQuery';
import { loadWorkspaceRoute } from '@/routes/lazy';

/** Warms everything opening /w/:id needs: the Workspace route chunk and the workspace data. */
export function prefetchWorkspace(queryClient: QueryClient, id: string): void {
  void loadWorkspaceRoute();
  void queryClient.prefetchQuery(workspaceQuery(id));
}
