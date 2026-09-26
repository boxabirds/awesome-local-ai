import { queryOptions } from '@tanstack/react-query';
import type { Workspace } from '@todoodle/shared/schemas';
import { getWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Query options for one workspace. Story 3 passes placeholderData from its remembered entry so the
 * name renders on /w/:id before GET returns.
 */
export function workspaceQuery(id: string, opts?: { placeholderData?: Workspace }) {
  return queryOptions({
    queryKey: queryKeys.workspace(id),
    queryFn: () => getWorkspace(id),
    placeholderData: opts?.placeholderData,
    refetchOnWindowFocus: true,
  });
}
