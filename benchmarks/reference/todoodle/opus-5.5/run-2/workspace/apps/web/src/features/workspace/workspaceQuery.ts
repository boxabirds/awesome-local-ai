import type { Workspace } from '@todoodle/shared/schemas';
import { queryOptions } from '@tanstack/react-query';
import { getWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Short enough that others' renames show on the next focus, long enough to skip a refetch right after open. */
const WORKSPACE_STALE_MS = 10_000;

/** Query options for one workspace. Story 3 passes placeholderData from its remembered entry. */
export function workspaceQuery(id: string, opts?: { placeholderData?: Workspace }) {
  return queryOptions({
    queryKey: queryKeys.workspace(id),
    queryFn: () => getWorkspace(id),
    placeholderData: opts?.placeholderData,
    staleTime: WORKSPACE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
