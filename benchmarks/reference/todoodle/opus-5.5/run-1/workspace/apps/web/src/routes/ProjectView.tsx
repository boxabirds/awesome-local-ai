import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { ProjectDot } from '@/features/projects/ProjectDot';
import { isProjectGone } from '@/features/projects/projectGone';
import { projectsQuery } from '@/features/projects/queries';
import { useProjects } from '@/features/projects/useProjects';
import type { QuickAddTarget } from '@/features/tasks/DestinationChip';
import { countsQuery, tasksQuery } from '@/features/tasks/queries';
import { TaskListView } from '@/features/tasks/TaskListView';
import { useWorkspace } from '@/features/workspace/useWorkspace';
import { useWorkspaceNavigate } from '@/features/workspace/useWorkspaceNavigate';
import { ApiError, GoneError } from '@/lib/api';
import { notifyAlert } from '@/lib/notify';
import type { ListScope } from '@/lib/queryKeys';

/** Shown (with a move to the Inbox) for an unknown or deleted project id in the address. */
export const PROJECT_NOT_FOUND_TEXT = 'Project not found';

// Hoisted (rendering-hoist-jsx). The hint follows the device, like the Inbox's: Q with a keyboard, + on touch.
const emptyProject = (
  <div className="flex flex-col items-center gap-3 py-12 text-center" data-empty-project>
    <p className="text-muted-foreground touch:hidden">No tasks yet. Press Q to add one.</p>
    <p className="hidden text-muted-foreground touch:block">No tasks yet. Tap + to add one.</p>
  </div>
);

function isMissing(error: unknown): boolean {
  return error instanceof GoneError || (error instanceof ApiError && error.status === 404);
}

/**
 * /w/:workspaceId/project/:projectId (lazy chunk; sidebar rows preload it): the project's colour dot and name,
 * then only its tasks in story 5/6's list view, with quick add adding to this project ('→ <name>'). Projects,
 * counts and the task list load in parallel (the list is never gated on the projects response). An unknown or
 * deleted project goes to the Inbox with 'Project not found' (unless this tab already knows it was deleted).
 */
export function ProjectView({ workspaceId }: { workspaceId: string }) {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const navigateTo = useWorkspaceNavigate();
  const projects = useProjects(workspaceId);
  const project = projects.data?.byId.get(projectId);
  const { data: workspace } = useWorkspace(workspaceId);
  const scope = useMemo<ListScope>(() => ({ list: 'project', projectId }), [projectId]);
  // The same cache entry the list view renders; read here only for its error.
  const list = useQuery({ ...tasksQuery(workspaceId, scope), enabled: false });

  // Route entry: projects, counts and this project's tasks together (async-parallel, no waterfall).
  useEffect(() => {
    void Promise.all([
      queryClient.prefetchQuery(projectsQuery(workspaceId)),
      queryClient.prefetchQuery(countsQuery(workspaceId)),
      queryClient.prefetchQuery(tasksQuery(workspaceId, scope)),
    ]);
  }, [queryClient, workspaceId, scope]);

  const missing = (projects.isSuccess && !project) || isMissing(list.error);
  useEffect(() => {
    if (!missing) return;
    navigateTo({ view: 'inbox' }, { replace: true });
    if (!isProjectGone(projectId)) notifyAlert(PROJECT_NOT_FOUND_TEXT, `project-not-found:${projectId}`);
  }, [missing, navigateTo, projectId]);

  const target = useMemo<QuickAddTarget>(
    () => ({ kind: 'project', id: projectId, name: project?.name ?? '', color: project?.color ?? '' }),
    [projectId, project?.name, project?.color],
  );
  const heading = useMemo(
    () => (
      <h1 id="view-title" tabIndex={-1} className="flex min-w-0 items-center gap-2 text-xl font-semibold outline-none">
        {project ? <ProjectDot color={project.color} className="size-3" /> : null}
        <span className="truncate">{project?.name ?? ''}</span>
      </h1>
    ),
    [project],
  );

  if (missing) return null;
  return (
    <>
      {project && workspace ? <title>{`${project.name} · ${workspace.name}`}</title> : null}
      <TaskListView workspaceId={workspaceId} scope={scope} heading={heading} empty={emptyProject} target={target} />
    </>
  );
}
