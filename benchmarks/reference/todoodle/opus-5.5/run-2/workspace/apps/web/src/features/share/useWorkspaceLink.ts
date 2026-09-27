import { useQuery } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { getWorkspaceLink } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** The link built from a secret that is already in memory (the /w#secret route). */
export function linkFromSecret(secret: string): string {
  return `${window.location.origin}/w#${secret}`;
}

/**
 * The workspace's full link. From the URL fragment when it is there (no request); otherwise
 * fetched from GET /api/w/:id/link only while `enabled`, and never kept in the cache.
 */
export function useWorkspaceLink(
  workspaceId: string,
  opts: { enabled: boolean },
): { link?: string; status: 'ready' | 'loading' | 'error'; retry(): void } {
  const context = useWorkspaceContext();
  const secret = context?.workspaceId === workspaceId ? context.secretFromHash : undefined;
  const query = useQuery({
    queryKey: queryKeys.link(workspaceId),
    queryFn: () => getWorkspaceLink(workspaceId),
    enabled: opts.enabled && !secret,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (secret) return { link: linkFromSecret(secret), status: 'ready', retry: () => {} };
  if (query.data) return { link: query.data, status: 'ready', retry: () => void query.refetch() };
  return { status: query.isError ? 'error' : 'loading', retry: () => void query.refetch() };
}
