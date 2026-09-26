import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { WorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { getWorkspaceLink } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export type WorkspaceLinkState = { link?: string; status: 'ready' | 'loading' | 'error'; retry(): void };

const noop = () => {};

/** The link built from a secret already in memory (the /w#<secret> route). */
export function linkFromSecret(secret: string): string {
  return `${window.location.origin}/w#${secret}`;
}

/**
 * The workspace's full link. On /w#<secret> it is built locally (no request). Otherwise it is fetched
 * from GET /api/w/:id/link only while `enabled` (the panel is open), and never kept in the cache.
 * Exported for story 3.
 */
export function useWorkspaceLink(workspaceId: string, opts: { enabled: boolean }): WorkspaceLinkState {
  const context = useContext(WorkspaceContext);
  const secret = context?.workspaceId === workspaceId ? context.secretFromHash : undefined;
  const query = useQuery({
    queryKey: queryKeys.link(workspaceId),
    queryFn: () => getWorkspaceLink(workspaceId),
    enabled: opts.enabled && !secret,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (secret) return { link: linkFromSecret(secret), status: 'ready', retry: noop };
  if (query.data) return { link: query.data, status: 'ready', retry: noop };
  return { status: query.isError ? 'error' : 'loading', retry: () => void query.refetch() };
}
