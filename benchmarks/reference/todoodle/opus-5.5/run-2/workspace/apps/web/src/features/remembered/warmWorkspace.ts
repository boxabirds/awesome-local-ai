import type { QueryClient } from '@tanstack/react-query';
import { preloadWorkspaceRoute } from '@/features/workspace/preloadWorkspaceRoute';
import { workspaceQuery } from '@/features/workspace/workspaceQuery';

/** Hover/focus on a way into a workspace: fetch its data and its route chunk before the click. */
export function warmWorkspace(client: QueryClient, id: string): void {
  void client.prefetchQuery(workspaceQuery(id));
  preloadWorkspaceRoute();
}
