import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { Counts, Project, UpdateProjectInput } from '@todoodle/shared/schemas';
import { useMemo } from 'react';
import { showUndoToast } from '@/features/undo/showUndoToast';
import type { LocalTask } from '@/features/tasks/taskCache';
import { SAVE_FAILED_TEXT } from '@/features/tasks/useTaskMutations';
import * as api from '@/lib/api';
import { ApiError, handleMutationError } from '@/lib/errors';
import { newProjectId } from '@/lib/ids';
import { notifyAlert } from '@/lib/notify';
import { type TasksFilter, queryKeys } from '@/lib/queryKeys';
import { adjustCounts, insertProject, removeProject } from './projectCache';
import { markProjectGone, unmarkProjectGone } from './projectGone';

/** The undo toast after a project deletion, and the note after a successful Undo. */
export const PROJECT_DELETED_TOAST = 'Project deleted';
export const PROJECT_RESTORED_TEXT = 'Project restored';

export type CreateOutcome = { status: 'created'; project: Project } | { status: 'limit' } | { status: 'failed' };

/** Every project action of one workspace. Stable for the app's lifetime (undo toasts keep calling them). */
export type ProjectActions = {
  /**
   * Optimistic create: the row shows at once; resolves when Todoodle answered. 409 limit_reached -> 'limit'
   * (the dialog explains); 409 id_conflict -> one retry with a fresh id; any other failure rolls back with
   * "Couldn't save — try again".
   */
  create(input: { name: string; color: Project['color'] }): Promise<CreateOutcome>;
  /** Optimistic rename / recolour; rolled back with the alert on failure (410: the project is removed). */
  update(id: string, patch: UpdateProjectInput): Promise<void>;
  /** Optimistic delete of the project and its tasks; offers Undo (restore) once saved. */
  remove(id: string): Promise<void>;
  /** Undo of a delete: restores the project and exactly the tasks that deletion removed. Rejects on failure. */
  restore(id: string, batchId: string): Promise<Project>;
};

type Snapshot = { projects: Project[] | undefined; counts: Counts | undefined };

/** The one implementation behind useProjectMutations (exported for tests with their own QueryClient). */
export function createProjectActions(queryClient: QueryClient, workspaceId: string): ProjectActions {
  const projectsKey = queryKeys.projects(workspaceId);
  const countsKey = queryKeys.counts(workspaceId);

  async function snapshot(): Promise<Snapshot> {
    // An in-flight list request predates this change and must not overwrite it.
    await queryClient.cancelQueries({ queryKey: projectsKey });
    return { projects: queryClient.getQueryData<Project[]>(projectsKey), counts: queryClient.getQueryData<Counts>(countsKey) };
  }

  function rollback(before: Snapshot): void {
    queryClient.setQueryData(projectsKey, before.projects);
    queryClient.setQueryData(countsKey, before.counts);
  }

  function writeProjects(fn: (list: Project[] | undefined) => Project[] | undefined): void {
    queryClient.setQueryData<Project[]>(projectsKey, (list) => (list ? fn(list) : list));
  }

  /** Every cached task list of one project. */
  function projectListKeys(projectId: string) {
    return queryClient
      .getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(workspaceId) })
      .map(([key]) => key)
      .filter((key) => {
        const filter = key[3] as TasksFilter | undefined;
        return filter?.list === 'project' && filter.projectId === projectId;
      });
  }

  function refreshAfterRestore(): void {
    void queryClient.invalidateQueries({ queryKey: projectsKey });
    void queryClient.invalidateQueries({ queryKey: countsKey });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) });
  }

  async function createOnce(input: { name: string; color: Project['color'] }, id: string): Promise<CreateOutcome | 'conflict'> {
    const before = await snapshot();
    const lastSort = before.projects?.reduce((max, project) => Math.max(max, project.sortOrder), 0) ?? 0;
    const optimistic: Project = { id, name: input.name, color: input.color, sortOrder: lastSort + 1, version: 0, createdAt: '', updatedAt: '' };
    writeProjects((list) => insertProject(list, optimistic));
    queryClient.setQueryData<Counts>(countsKey, (counts) => adjustCounts(counts, { projects: { [id]: {} } }));
    try {
      const project = await api.createProject(workspaceId, { id, name: input.name, color: input.color });
      writeProjects((list) => insertProject(list, project));
      return { status: 'created', project };
    } catch (error) {
      rollback(before);
      if (error instanceof ApiError && error.code === 'limit_reached') return { status: 'limit' };
      if (error instanceof ApiError && error.code === 'id_conflict') return 'conflict';
      notifyAlert(SAVE_FAILED_TEXT);
      return { status: 'failed' };
    }
  }

  const actions: ProjectActions = {
    async create(input) {
      const first = await createOnce(input, newProjectId());
      if (first !== 'conflict') return first;
      // The id was already taken (another workspace): once more with a fresh one.
      const second = await createOnce(input, newProjectId());
      if (second !== 'conflict') return second;
      notifyAlert(SAVE_FAILED_TEXT);
      return { status: 'failed' };
    },

    async update(id, patch) {
      const before = await snapshot();
      const current = before.projects?.find((project) => project.id === id);
      if (!current) return;
      writeProjects((list) => list?.map((project) => (project.id === id ? { ...project, ...patch } : project)));
      try {
        const saved = await api.updateProject(workspaceId, id, patch);
        writeProjects((list) => list?.map((project) => (project.id === id && project.version <= saved.version ? saved : project)));
      } catch (error) {
        const gone = handleMutationError(error, {
          key: `project:${id}`,
          entityLabel: 'project',
          workspaceId,
          queryClient,
          rollback: () => rollback(before),
        });
        if (gone) {
          markProjectGone(id);
          queryClient.setQueryData<Counts>(countsKey, (counts) => adjustCounts(counts, { remove: [id] }));
          return;
        }
        notifyAlert(SAVE_FAILED_TEXT);
      }
    },

    async remove(id) {
      const before = await snapshot();
      if (!before.projects?.some((project) => project.id === id)) return;
      const listKeys = projectListKeys(id);
      const lists = listKeys.map((key) => [key, queryClient.getQueryData<LocalTask[]>(key)] as const);
      markProjectGone(id);
      writeProjects((list) => removeProject(list, id));
      queryClient.setQueryData<Counts>(countsKey, (counts) => adjustCounts(counts, { remove: [id] }));
      for (const key of listKeys) queryClient.removeQueries({ queryKey: key, exact: true });
      try {
        const { batchId } = await api.deleteProject(workspaceId, id);
        showUndoToast({
          message: PROJECT_DELETED_TOAST,
          restoredText: PROJECT_RESTORED_TEXT,
          inverse: () => actions.restore(id, batchId),
        });
      } catch (error) {
        unmarkProjectGone(id);
        rollback(before);
        for (const [key, data] of lists) if (data) queryClient.setQueryData(key, data);
        const gone = handleMutationError(error, { key: `project:${id}`, entityLabel: 'project', workspaceId, queryClient });
        if (gone) {
          markProjectGone(id);
          queryClient.setQueryData<Counts>(countsKey, (counts) => adjustCounts(counts, { remove: [id] }));
          return;
        }
        notifyAlert(SAVE_FAILED_TEXT);
      }
    },

    async restore(id, batchId) {
      const { project } = await api.restoreProject(workspaceId, id, batchId);
      unmarkProjectGone(id);
      writeProjects((list) => insertProject(list, project));
      refreshAfterRestore();
      return project;
    },
  };
  return actions;
}

const instances = new WeakMap<QueryClient, Map<string, ProjectActions>>();

/** The workspace's project actions: one instance per query client and workspace, so references never go stale. */
export function projectActionsFor(queryClient: QueryClient, workspaceId: string): ProjectActions {
  let byWorkspace = instances.get(queryClient);
  if (!byWorkspace) {
    byWorkspace = new Map();
    instances.set(queryClient, byWorkspace);
  }
  let actions = byWorkspace.get(workspaceId);
  if (!actions) {
    actions = createProjectActions(queryClient, workspaceId);
    byWorkspace.set(workspaceId, actions);
  }
  return actions;
}

/** Create, rename, delete and restore for one workspace (stable functions). */
export function useProjectMutations(workspaceId: string): ProjectActions {
  const queryClient = useQueryClient();
  return useMemo(() => projectActionsFor(queryClient, workspaceId), [queryClient, workspaceId]);
}
