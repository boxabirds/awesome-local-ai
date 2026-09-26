import { queryOptions } from '@tanstack/react-query';
import type { Workspace } from '@todoodle/shared/schemas';
import { rememberedPlaceholder } from '@/features/remembered/rememberedPlaceholder';
import { getWorkspace } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Stand-in while GET is pending, built from this browser's cached remembered list (story 3) so the
 * header shows the name at once. Only id and name are known; isPlaceholderData marks it, and it is
 * never written to the cache.
 */
function placeholderFromRemembered(id: string): Workspace | undefined {
  const remembered = rememberedPlaceholder(queryClient, id);
  return remembered ? { ...remembered, version: 0, createdAt: '' } : undefined;
}

/** Query options for one workspace. `opts.placeholderData` overrides the remembered-list placeholder. */
export function workspaceQuery(id: string, opts?: { placeholderData?: Workspace }) {
  return queryOptions({
    queryKey: queryKeys.workspace(id),
    queryFn: () => getWorkspace(id),
    placeholderData: () => opts?.placeholderData ?? placeholderFromRemembered(id),
    refetchOnWindowFocus: true,
  });
}
