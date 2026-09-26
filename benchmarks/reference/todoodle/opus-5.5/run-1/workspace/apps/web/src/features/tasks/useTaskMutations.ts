import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { COMPLETE_ANIMATION_MS, TASK_SORT_STEP } from '@todoodle/shared/limits';
import { type Counts, type Task, type TaskPatch, resolvePatchedName } from '@todoodle/shared/schemas';
import { useMemo } from 'react';
import * as api from '@/lib/api';
import { handleMutationError } from '@/lib/errors';
import { prefersReducedMotion } from '@/lib/motion';
import { notifyAlert } from '@/lib/notify';
import { type TasksFilter, queryKeys, scopeHolds } from '@/lib/queryKeys';
import {
  type ListShape,
  completeInCache,
  findTask,
  finishLeaving,
  placeTask,
  removeFromCache,
  reopenInCache,
  rollbackTask,
  updateInCache,
} from './cacheOps';
import { moveCountsDelta, adjustCounts as applyCountsDelta } from '@/features/projects/projectCache';
import { endBusy, startBusy } from './taskBusy';
import { type LocalTask, adjustCount } from './taskCache';

/** Shown (role=alert) when a change could not be saved and was rolled back. */
export const SAVE_FAILED_TEXT = "Couldn't save — try again";

/** Every task action of one workspace. Stable for the app's lifetime (undo toasts keep calling them). */
export type TaskActions = {
  /** Optimistic: ticks at once, leaves the open list after COMPLETE_ANIMATION_MS (0 under reduced motion). */
  complete(id: string): Promise<void>;
  /** Optimistic reopen (a completed row's checkbox): back to its original position. */
  reopen(id: string): Promise<void>;
  /** Optimistic edit. Rejects when it failed (GoneError for 410), after rolling back and telling the user. */
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** Optimistic soft delete: gone at once, no confirmation. */
  remove(id: string): Promise<void>;
  /** Undo of a completion: POST reopen, then the task goes back where it was. Rejects on failure. */
  undoComplete(id: string): Promise<Task>;
  /** Undo of a delete: POST restore, then the task goes back where it was. Rejects on failure. */
  undoDelete(id: string): Promise<Task>;
  /**
   * Story 7: optimistic move to a project, or to the Inbox (null). The task leaves its list at once (focus
   * goes to its neighbour), joins the end of the destination list if that is loaded, and the counts follow.
   * Rolled back with "Couldn't save — try again" on failure; 410 says 'This task was deleted'.
   */
  move(id: string, projectId: string | null): Promise<void>;
};

/** Hooks the focus and undo features plug into (tasks 5 and 13), so this module stays about the cache. */
export type TaskActionHooks = {
  /** A focused or opened task is about to leave the current list (its row is still in the DOM). */
  beforeRemoval(id: string): void;
  /** A removal was rolled back: the task is back (its row is about to re-render). */
  afterRollback(id: string): void;
  /** A completion or delete was saved: offer Undo. */
  offerUndo(kind: 'completed' | 'deleted', inverse: () => Promise<unknown>): void;
};

const hooks: TaskActionHooks = { beforeRemoval: () => {}, afterRollback: () => {}, offerUndo: () => {} };

/** Installed once by the focus and undo modules. */
export function setTaskActionHooks(next: Partial<TaskActionHooks>): void {
  Object.assign(hooks, next);
}

type Snapshot = Array<[QueryKey, LocalTask[] | undefined]>;

/** The one implementation behind the hooks below (exported for tests with their own QueryClient). */
export function createTaskActions(queryClient: QueryClient, workspaceId: string): TaskActions {
  const prefix = queryKeys.tasks(workspaceId);
  const leavingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const snapshot = (): Snapshot => queryClient.getQueriesData<LocalTask[]>({ queryKey: prefix });

  /**
   * Applies `fn` to every cached list of this workspace (both includeCompleted variants of every list). Story 7:
   * with `projectId` (null = Inbox), only the lists of that scope, so a write that may insert the task (placeTask)
   * never puts a project task into the Inbox or another project.
   */
  function writeLists(fn: (list: LocalTask[] | undefined, shape: ListShape) => LocalTask[] | undefined, projectId?: string | null): void {
    for (const [key, list] of snapshot()) {
      const filter = key[3] as TasksFilter | undefined;
      if (!filter) continue;
      if (projectId !== undefined && !scopeHolds(filter, projectId)) continue;
      const next = fn(list, { includeCompleted: filter.includeCompleted });
      if (next !== list) queryClient.setQueryData(key, next);
    }
  }

  function find(id: string): LocalTask | undefined {
    return findTask(
      snapshot().map(([, list]) => list),
      id,
    );
  }

  /** Open-count delta for the task's list (story 7: the Inbox or its project), and the project's total. */
  function adjustCounts(delta: number, task: Pick<LocalTask, 'projectId'> | undefined, totalDelta = 0): void {
    queryClient.setQueryData<Counts>(queryKeys.counts(workspaceId), (counts) => adjustCount(counts, delta, task?.projectId ?? null, totalDelta));
  }

  /** Puts this one task back as it was in `before` (other rows keep any change made meanwhile). */
  function rollback(before: Snapshot, id: string): void {
    for (const [key, list] of before) {
      queryClient.setQueryData<LocalTask[]>(key, (current) => rollbackTask(current, list, id));
    }
  }

  /** Rolls back, then explains: 410 -> the task is gone (removed, 'This task was deleted'); else the alert. */
  function fail(error: unknown, id: string, before: Snapshot): void {
    const gone = handleMutationError(error, {
      key: `task:${id}`,
      entityLabel: 'task',
      workspaceId,
      queryClient,
      rollback: () => rollback(before, id),
    });
    if (gone) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.counts(workspaceId) });
      return;
    }
    notifyAlert(SAVE_FAILED_TEXT);
  }

  /** Stops the cache from being overwritten by a list request already in flight (it predates the change). */
  const cancelLists = () => queryClient.cancelQueries({ queryKey: prefix });

  function stopLeaving(id: string): void {
    const timer = leavingTimers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    leavingTimers.delete(id);
  }

  const actions: TaskActions = {
    async complete(id) {
      const task = find(id);
      if (!task || task.localStatus !== undefined || task.completedAt !== null) return;
      startBusy(id);
      try {
        await cancelLists();
        const before = snapshot();
        const animate = COMPLETE_ANIMATION_MS > 0 && !prefersReducedMotion();
        const completedAt = new Date().toISOString();
        const leave = () => {
          leavingTimers.delete(id);
          hooks.beforeRemoval(id);
          writeLists((list, shape) => finishLeaving(list, id, shape));
        };
        if (!animate) hooks.beforeRemoval(id);
        writeLists((list, shape) => completeInCache(list, id, completedAt, { ...shape, leaving: animate }));
        adjustCounts(-1, task);
        if (animate) leavingTimers.set(id, setTimeout(leave, COMPLETE_ANIMATION_MS));
        try {
          const saved = await api.completeTask(workspaceId, id);
          writeLists((list, shape) => updateInCache(list, saved, shape));
          hooks.offerUndo('completed', () => actions.undoComplete(id));
        } catch (error) {
          stopLeaving(id);
          adjustCounts(1, task);
          fail(error, id, before);
          hooks.afterRollback(id);
        }
      } finally {
        endBusy(id);
      }
    },

    async reopen(id) {
      const task = find(id);
      if (!task || task.completedAt === null || task.leaving) return;
      startBusy(id);
      try {
        await cancelLists();
        const before = snapshot();
        hooks.beforeRemoval(id);
        writeLists((list, shape) => reopenInCache(list, task, shape), task.projectId ?? null);
        adjustCounts(1, task);
        try {
          const saved = await api.reopenTask(workspaceId, id);
          writeLists((list, shape) => updateInCache(list, saved, shape));
        } catch (error) {
          adjustCounts(-1, task);
          fail(error, id, before);
          hooks.afterRollback(id);
        }
      } finally {
        endBusy(id);
      }
    },

    async update(id, patch) {
      const task = find(id);
      if (!task) throw new api.GoneError();
      startBusy(id);
      try {
        await cancelLists();
        const before = snapshot();
        const optimistic: LocalTask = {
          ...task,
          name: resolvePatchedName(patch.name, task.name),
          description: patch.description === undefined ? task.description : patch.description.trim(),
        };
        writeLists((list, shape) => updateInCache(list, optimistic, shape));
        try {
          const saved = await api.updateTask(workspaceId, id, patch);
          writeLists((list, shape) => updateInCache(list, saved, shape));
          return saved;
        } catch (error) {
          fail(error, id, before);
          throw error;
        }
      } finally {
        endBusy(id);
      }
    },

    async remove(id) {
      const task = find(id);
      if (!task || task.localStatus !== undefined) return;
      startBusy(id);
      // Focus moves while the row is still on screen (it disappears with the cache write below).
      hooks.beforeRemoval(id);
      try {
        stopLeaving(id);
        await cancelLists();
        const before = snapshot();
        const wasOpen = task.completedAt === null;
        writeLists((list) => removeFromCache(list, id));
        adjustCounts(wasOpen ? -1 : 0, task, -1);
        try {
          await api.deleteTask(workspaceId, id);
          hooks.offerUndo('deleted', () => actions.undoDelete(id));
        } catch (error) {
          adjustCounts(wasOpen ? 1 : 0, task, 1);
          fail(error, id, before);
          hooks.afterRollback(id);
        }
      } finally {
        endBusy(id);
      }
    },

    async undoComplete(id) {
      const saved = await api.reopenTask(workspaceId, id);
      stopLeaving(id);
      const wasOpen = find(id)?.completedAt === null;
      writeLists((list, shape) => placeTask(list, saved, shape), saved.projectId);
      if (!wasOpen) adjustCounts(1, saved);
      return saved;
    },

    async move(id, projectId) {
      const task = find(id);
      if (!task || task.localStatus !== undefined || (task.projectId ?? null) === projectId) return;
      startBusy(id);
      // Focus moves while the row is still on screen (it leaves the list with the cache write below).
      hooks.beforeRemoval(id);
      try {
        stopLeaving(id);
        await cancelLists();
        const before = snapshot();
        // The end of the destination list (the server puts it at the workspace's MAX + TASK_SORT_STEP).
        const lastSort = before.reduce((max, [, list]) => Math.max(max, ...(list ?? []).map((item) => item.sortOrder)), 0);
        const { leaving: _leaving, ...settled } = task;
        const moved: LocalTask = { ...settled, projectId, sortOrder: lastSort + TASK_SORT_STEP };
        writeLists((list) => removeFromCache(list, id));
        writeLists((list, shape) => placeTask(list, moved, shape), projectId);
        const delta = moveCountsDelta(task, projectId);
        queryClient.setQueryData<Counts>(queryKeys.counts(workspaceId), (counts) => applyCountsDelta(counts, delta));
        try {
          const saved = await api.moveTask(workspaceId, id, projectId);
          writeLists((list) => removeFromCache(list, id));
          writeLists((list, shape) => placeTask(list, saved, shape), saved.projectId);
        } catch (error) {
          queryClient.setQueryData<Counts>(queryKeys.counts(workspaceId), (counts) =>
            applyCountsDelta(counts, moveCountsDelta({ ...task, projectId }, task.projectId ?? null)),
          );
          fail(error, id, before);
          hooks.afterRollback(id);
        }
      } finally {
        endBusy(id);
      }
    },

    async undoDelete(id) {
      const saved = await api.restoreTask(workspaceId, id);
      const cached = find(id);
      writeLists((list, shape) => placeTask(list, saved, shape), saved.projectId);
      if (!cached) adjustCounts(saved.completedAt === null ? 1 : 0, saved, 1);
      else if (saved.completedAt === null && cached.completedAt !== null) adjustCounts(1, saved);
      return saved;
    },
  };
  return actions;
}

const instances = new WeakMap<QueryClient, Map<string, TaskActions>>();

/** The workspace's task actions: one instance per query client and workspace, so references never go stale. */
export function taskActionsFor(queryClient: QueryClient, workspaceId: string): TaskActions {
  let byWorkspace = instances.get(queryClient);
  if (!byWorkspace) {
    byWorkspace = new Map();
    instances.set(queryClient, byWorkspace);
  }
  let actions = byWorkspace.get(workspaceId);
  if (!actions) {
    actions = createTaskActions(queryClient, workspaceId);
    byWorkspace.set(workspaceId, actions);
  }
  return actions;
}

export function useTaskActions(workspaceId: string): TaskActions {
  const queryClient = useQueryClient();
  return useMemo(() => taskActionsFor(queryClient, workspaceId), [queryClient, workspaceId]);
}

export const useCompleteTask = (workspaceId: string) => useTaskActions(workspaceId).complete;
export const useReopenTask = (workspaceId: string) => useTaskActions(workspaceId).reopen;
export const useUpdateTask = (workspaceId: string) => useTaskActions(workspaceId).update;
export const useDeleteTask = (workspaceId: string) => useTaskActions(workspaceId).remove;
export const useRestoreTask = (workspaceId: string) => useTaskActions(workspaceId).undoDelete;
