import { useEffect, useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { useWorkspaceNavigate } from '@/features/workspace/useWorkspaceNavigate';
import { notifyStatus } from '@/lib/notify';
import { registerProjectLiveHandlers } from './registerProjectLiveHandlers';

/** Shown to someone whose open project was deleted by someone else. */
export const PROJECT_DELETED_TEXT = 'This project was deleted';

/**
 * Registers the project live handlers once per workspace (client-event-listeners: not per row). The routed
 * project id and the navigate function are read through refs, so route changes never re-register.
 */
export function useProjectLiveHandlers(workspaceId: string): void {
  const { projectId } = useParams();
  const navigateTo = useWorkspaceNavigate();
  const current = useRef({ projectId, navigateTo });
  useLayoutEffect(() => {
    current.current = { projectId, navigateTo };
  });
  useEffect(
    () =>
      registerProjectLiveHandlers({
        currentProjectId: () => current.current.projectId ?? null,
        onViewedProjectDeleted: () => {
          current.current.navigateTo({ view: 'inbox' });
          notifyStatus(PROJECT_DELETED_TEXT, 'project-deleted');
        },
      }),
    [workspaceId],
  );
}

/** Mount point for useProjectLiveHandlers inside the workspace context (renders nothing). */
export function ProjectLiveHandlers({ workspaceId }: { workspaceId: string }): null {
  useProjectLiveHandlers(workspaceId);
  return null;
}
