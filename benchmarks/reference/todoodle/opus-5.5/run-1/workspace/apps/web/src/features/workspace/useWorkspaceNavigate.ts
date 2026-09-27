import { useCallback, useLayoutEffect, useRef } from 'react';
import { type NavigateOptions, useLocation, useNavigate } from 'react-router';
import { useWorkspaceContext } from './WorkspaceContext';

/** Where in the workspace to go: the Inbox, one project (story 7), or Today (story 8). */
export type WorkspaceTarget = { view: 'inbox' } | { view: 'project'; projectId: string } | { view: 'today' };

/** The path of a workspace view (SPA routing decision: /w/:id, /w/:id/project/:pid, /w/:id/today). */
export function workspacePath(workspaceId: string, target: WorkspaceTarget): string {
  const base = `/w/${encodeURIComponent(workspaceId)}`;
  if (target.view === 'project') return `${base}/project/${encodeURIComponent(target.projectId)}`;
  return target.view === 'today' ? `${base}/today` : base;
}

/** Whether a path is a workspace's Today address (/w/:id/today). */
export function isTodayPath(pathname: string): boolean {
  return /^\/w\/[^/]+\/today\/?$/.test(pathname);
}

/**
 * All in-app navigation between workspace views. Carries location.hash over when there is one (a session
 * opened by link keeps a bookmarkable address) and otherwise navigates path-only. The returned function is
 * stable (the hash is read from a ref), so memoised rows can hold it.
 */
export function useWorkspaceNavigate(): (target: WorkspaceTarget, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspaceContext();
  const { hash } = useLocation();
  const hashRef = useRef(hash);
  useLayoutEffect(() => {
    hashRef.current = hash;
  });
  return useCallback(
    (target, options) => navigate({ pathname: workspacePath(workspaceId, target), hash: hashRef.current || undefined }, options),
    [navigate, workspaceId],
  );
}
