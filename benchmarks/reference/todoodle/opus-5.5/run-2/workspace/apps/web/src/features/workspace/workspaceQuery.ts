import type { Workspace } from '@todoodle/shared/schemas';
import { queryOptions } from '@tanstack/react-query';
import { rememberedPlaceholder } from '@/features/remembered/rememberedPlaceholder';
import { getWorkspace } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

/** Short enough that others' renames show on the next focus, long enough to skip a refetch right after open. */
const WORKSPACE_STALE_MS = 10_000;

/**
 * The remembered name as a placeholder, so the header shows it before GET returns. Only `id` and
 * `name` are real; the view never shows version or createdAt while `isPlaceholderData`. Read-only:
 * nothing is written to the cache, and a 404 drops it.
 */
function placeholderFromRemembered(id: string): Workspace | undefined {
  const known = rememberedPlaceholder(queryClient, id);
  return known ? { ...known, version: 0, createdAt: '' } : undefined;
}

/** Query options for one workspace. */
export function workspaceQuery(id: string, opts?: { placeholderData?: Workspace }) {
  return queryOptions({
    queryKey: queryKeys.workspace(id),
    queryFn: () => getWorkspace(id),
    placeholderData: () => opts?.placeholderData ?? placeholderFromRemembered(id),
    staleTime: WORKSPACE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
