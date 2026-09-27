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
 * fetched from GET /api/w/:id/link only while `enabled` (or on `refetch()`), and never kept in
 * the cache. `refetch()` resolves to the link or rejects, for callers that fetch on a click.
 */
export function useWorkspaceLink(
  workspaceId: string,
  opts: { enabled: boolean },
): { link?: string; status: 'ready' | 'loading' | 'error'; retry(): void; refetch(): Promise<string> } {
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
  const retry = () => void query.refetch();
  const refetch = async () => {
    if (secret) return linkFromSecret(secret);
    const result = await query.refetch({ throwOnError: true });
    if (result.data === undefined) throw new Error('No link');
    return result.data;
  };
  if (secret) return { link: linkFromSecret(secret), status: 'ready', retry: () => {}, refetch };
  if (query.data) return { link: query.data, status: 'ready', retry, refetch };
  return { status: query.isError ? 'error' : 'loading', retry, refetch };
}
