import { useCallback, useLayoutEffect, useRef } from 'react';
import { type NavigateOptions, useLocation, useNavigate } from 'react-router';
import { useWorkspaceContext } from './WorkspaceContext';

/** Where in the workspace to go: the Inbox, or one project (story 7). Story 8 adds Today. */
export type WorkspaceTarget = { view: 'inbox' } | { view: 'project'; projectId: string };

/** The path of a workspace view (SPA routing decision: /w/:id, /w/:id/project/:pid). */
export function workspacePath(workspaceId: string, target: WorkspaceTarget): string {
  const base = `/w/${encodeURIComponent(workspaceId)}`;
  return target.view === 'project' ? `${base}/project/${encodeURIComponent(target.projectId)}` : base;
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
