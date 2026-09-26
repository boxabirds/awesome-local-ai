import { queryOptions } from '@tanstack/react-query';
import { listProjects } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** The workspace's active projects in creation order (the sidebar, the project view header, Move to…). */
export function projectsQuery(workspaceId: string) {
  return queryOptions({ queryKey: queryKeys.projects(workspaceId), queryFn: () => listProjects(workspaceId) });
}
