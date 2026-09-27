import { COMPLETE_ANIMATION_MS } from '@todoodle/shared/limits';
import type { Task, TaskPatch } from '@todoodle/shared/schemas';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { createElement, useLayoutEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { UndoHandle } from '@/features/undo/createUndo';
import { showUndoToast } from '@/features/undo/showUndoToast';
import * as api from '@/lib/api';
import { handleMutationError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { completeInCache, findInCache, placeTask, removeFromCache, reopenInCache, updateInCache } from './cacheOps';
import { checkedStore } from './checkedStore';
import { focusAfterRemoval, focusIsInRow, focusRowWhenPresent, rowElement } from './focusAfterAction';
import {
  adjustOpenCount,
  type CacheSnapshot,
  findCachedTask,
  restoreTaskCaches,
  snapshotTaskCaches,
  taskTombstones,
  updateTaskLists,
} from './taskLists';

export const SAVE_FAILED_TEXT = "Couldn't save — try again";
export const COMPLETED_TEXT = 'Task completed';
export const DELETED_TEXT = 'Task deleted';

/** A failure the user must hear at once: role=alert inside the toast. */
export function showSaveFailed(): void {
  toast.error(createElement('span', { role: 'alert' }, SAVE_FAILED_TEXT), { id: 'task-save-failed' });
}

/** Read at call time: with reduced motion a completed task leaves at once. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Key of every story 6 task mutation: ['ws', id, 'task', operation] (busyStore reads it). */
const taskMutationKey = (workspaceId: string, operation: string) => [...qk.root(workspaceId), 'task', operation] as const;

/**
 * Moves focus to the row's neighbour (or the add-task control) when the focus is in the row, or
 * always with `force` (the row's menu, whose items are outside the row). Returns true when it moved.
 */
function moveFocusOffRow(id: string, force = false): boolean {
  if (!force && !focusIsInRow(id)) return false;
  const list = rowElement(id)?.parentElement;
  if (!list) return false;
  focusAfterRemoval(list, id);
  return true;
}

/** Writes the server's copy into every list, unless a list already has a newer version (a live event). */
function writeServerTask(client: QueryClient, workspaceId: string, task: Task) {
  updateTaskLists(client, workspaceId, (list, includeCompleted) => {
    const cached = findInCache(list, task.id);
    if (cached && cached.version > task.version) return list;
    return placeTask(list, task, includeCompleted);
  });
}

/** onError for every optimistic mutation: rollback, then "deleted" or "Couldn't save". */
function failed(client: QueryClient, workspaceId: string, id: string, error: unknown, snapshot: CacheSnapshot | undefined) {
  const gone = handleMutationError(error, {
    key: `task:${id}`,
    entityLabel: 'task',
    rollback: snapshot ? () => restoreTaskCaches(client, workspaceId, snapshot) : undefined,
  });
  if (gone) {
    taskTombstones.add(id, Number.MAX_SAFE_INTEGER);
    void client.invalidateQueries({ queryKey: qk.counts(workspaceId) });
  } else {
    showSaveFailed();
  }
  return gone;
}

type IdVars = { id: string };
type CompleteVars = IdVars & { delay: number };
type RemoveVars = IdVars & { moveFocus: boolean };
type UpdateVars = IdVars & { patch: TaskPatch };

type CompleteCtx = {
  snapshot: CacheSnapshot;
  timer: ReturnType<typeof setTimeout> | null;
  left: boolean;
  server: Task | null;
  movedFocus: boolean;
  undo: UndoHandle | null;
};

type RemoveCtx = { snapshot: CacheSnapshot; movedFocus: boolean; undo: UndoHandle | null };

export type TaskMutations = {
  /** Ticks at once; the task leaves the open list after COMPLETE_ANIMATION_MS (0 with reduced motion). Offers Undo. */
  complete(id: string): void;
  /** Back to the open list at its original position. */
  reopen(id: string): void;
  /** Complete an open task, reopen a completed one. */
  toggle(id: string): void;
  /**
   * Deletes at once (no confirmation) and offers Undo. `moveFocus` (default: when focus is in the
   * row) sends focus to the next row first; the detail sheet passes false and moves focus itself.
   */
  remove(id: string, opts?: { moveFocus?: boolean }): void;
  /** Saves name and/or description (optimistic; rolled back and announced on failure). */
  update(id: string, patch: TaskPatch): Promise<Task>;
};

/**
 * Optimistic task lifecycle mutations for one workspace (every cached list: open-only and with
 * completed). Each change shows at once, is rolled back with "Couldn't save — try again" (an
 * alert) when it fails, or removed with "This task was deleted" on 410. Completing and deleting
 * offer Undo: a server inverse (reopen or restore) sent after the original request has settled.
 */
export function useTaskMutations(workspaceId: string): TaskMutations {
  const client = useQueryClient();
  /** The original request of a pending undo, so the inverse is never sent before it. */
  const inflight = useRef(new Map<string, Promise<unknown>>());

  const completeM = useMutation<Task, unknown, CompleteVars, CompleteCtx>({
    mutationKey: taskMutationKey(workspaceId, 'complete'),
    mutationFn: ({ id }) => api.completeTask(workspaceId, id),
    onMutate: ({ id, delay }) => {
      void client.cancelQueries({ queryKey: qk.taskLists(workspaceId) });
      const snapshot = snapshotTaskCaches(client, workspaceId);
      const wasOpen = findCachedTask(client, workspaceId, id)?.completedAt === null;
      const completedAt = new Date().toISOString();
      const ctx: CompleteCtx = { snapshot, timer: null, left: false, server: null, movedFocus: false, undo: null };
      const leave = () => {
        ctx.timer = null;
        ctx.left = true;
        ctx.movedFocus = moveFocusOffRow(id);
        const server = ctx.server;
        updateTaskLists(client, workspaceId, (list, inc) =>
          server ? placeTask(list, server, inc) : completeInCache(list, id, completedAt, inc),
        );
        if (wasOpen) adjustOpenCount(client, workspaceId, -1);
        // The row drops its pending tick once it renders the completed task (or goes).
      };
      if (delay <= 0) leave();
      else ctx.timer = setTimeout(leave, delay);
      ctx.undo = showUndoToast({ message: COMPLETED_TEXT, inverse: () => inverses.current.reopen(id) });
      return ctx;
    },
    onSuccess: (task, _vars, ctx) => {
      if (ctx.left) writeServerTask(client, workspaceId, task);
      else ctx.server = task;
    },
    onError: (error, { id }, ctx) => {
      if (!ctx) return;
      if (ctx.timer) clearTimeout(ctx.timer);
      ctx.undo?.cancel();
      checkedStore.clear(id);
      const gone = failed(client, workspaceId, id, error, ctx.snapshot);
      if (!gone && ctx.movedFocus) focusRowWhenPresent(id);
    },
  });

  const reopenM = useMutation<Task, unknown, IdVars, { snapshot: CacheSnapshot }>({
    mutationKey: taskMutationKey(workspaceId, 'reopen'),
    mutationFn: ({ id }) => api.reopenTask(workspaceId, id),
    onMutate: ({ id }) => {
      void client.cancelQueries({ queryKey: qk.taskLists(workspaceId) });
      const snapshot = snapshotTaskCaches(client, workspaceId);
      const task = findCachedTask(client, workspaceId, id);
      if (task && task.completedAt !== null) {
        updateTaskLists(client, workspaceId, (list, inc) => reopenInCache(list, task, inc));
        adjustOpenCount(client, workspaceId, 1);
      }
      return { snapshot };
    },
    onSuccess: (task) => writeServerTask(client, workspaceId, task),
    onError: (error, { id }, ctx) => {
      checkedStore.clear(id);
      failed(client, workspaceId, id, error, ctx?.snapshot);
    },
  });

  const removeM = useMutation<void, unknown, RemoveVars, RemoveCtx>({
    mutationKey: taskMutationKey(workspaceId, 'delete'),
    mutationFn: ({ id }) => api.deleteTask(workspaceId, id),
    onMutate: ({ id, moveFocus }) => {
      void client.cancelQueries({ queryKey: qk.taskLists(workspaceId) });
      const snapshot = snapshotTaskCaches(client, workspaceId);
      const task = findCachedTask(client, workspaceId, id);
      const movedFocus = moveFocus ? moveFocusOffRow(id, true) : false;
      updateTaskLists(client, workspaceId, (list) => removeFromCache(list, id));
      if (task?.completedAt === null) adjustOpenCount(client, workspaceId, -1);
      // The server bumps the version by one; live changes older than that are ignored.
      taskTombstones.add(id, (task?.version ?? 0) + 1);
      const undo = showUndoToast({ message: DELETED_TEXT, inverse: () => inverses.current.restore(id) });
      return { snapshot, movedFocus, undo };
    },
    onError: (error, { id }, ctx) => {
      if (!ctx) return;
      ctx.undo?.cancel();
      taskTombstones.delete(id);
      if (!failed(client, workspaceId, id, error, ctx.snapshot) && ctx.movedFocus) focusRowWhenPresent(id);
    },
  });

  const updateM = useMutation<Task, unknown, UpdateVars, { snapshot: CacheSnapshot }>({
    mutationKey: taskMutationKey(workspaceId, 'update'),
    mutationFn: ({ id, patch }) => api.updateTask(workspaceId, id, patch),
    onMutate: ({ id, patch }) => {
      void client.cancelQueries({ queryKey: qk.taskLists(workspaceId) });
      const snapshot = snapshotTaskCaches(client, workspaceId);
      updateTaskLists(client, workspaceId, (list) => updateInCache(list, id, patch));
      return { snapshot };
    },
    onSuccess: (task) => writeServerTask(client, workspaceId, task),
    onError: (error, { id }, ctx) => void failed(client, workspaceId, id, error, ctx?.snapshot),
  });

  // Undo inverses: not optimistic (the task comes back when the server says so).
  const undoReopenM = useMutation<Task, unknown, IdVars>({
    mutationKey: taskMutationKey(workspaceId, 'undo-complete'),
    mutationFn: ({ id }) => api.reopenTask(workspaceId, id),
    onSuccess: (task) => {
      const wasOpen = findCachedTask(client, workspaceId, task.id)?.completedAt === null;
      writeServerTask(client, workspaceId, task);
      if (!wasOpen && task.completedAt === null) adjustOpenCount(client, workspaceId, 1);
    },
  });

  const restoreM = useMutation<Task, unknown, IdVars>({
    mutationKey: taskMutationKey(workspaceId, 'restore'),
    mutationFn: ({ id }) => api.restoreTask(workspaceId, id),
    onSuccess: (task) => {
      taskTombstones.delete(task.id);
      const present = findCachedTask(client, workspaceId, task.id) !== undefined;
      writeServerTask(client, workspaceId, task);
      if (!present && task.completedAt === null) adjustOpenCount(client, workspaceId, 1);
    },
  });

  // Toasts outlive renders: they call the latest inverses through a ref (never a stale closure).
  const inverses = useRef({
    reopen: async (_id: string): Promise<unknown> => undefined,
    restore: async (_id: string): Promise<unknown> => undefined,
  });
  const undoReopen = undoReopenM.mutateAsync;
  const restore = restoreM.mutateAsync;
  useLayoutEffect(() => {
    inverses.current = {
      reopen: async (id) => {
        await inflight.current.get(id);
        return undoReopen({ id });
      },
      restore: async (id) => {
        await inflight.current.get(id);
        return restore({ id });
      },
    };
  }, [undoReopen, restore]);

  const completeAsync = completeM.mutateAsync;
  const reopenMutate = reopenM.mutate;
  const removeAsync = removeM.mutateAsync;
  const updateAsync = updateM.mutateAsync;

  return useMemo<TaskMutations>(() => {
    const track = (id: string, promise: Promise<unknown>) => {
      const settled = promise.then(
        () => undefined,
        () => undefined,
      );
      inflight.current.set(id, settled);
      void settled.then(() => {
        if (inflight.current.get(id) === settled) inflight.current.delete(id);
      });
    };
    const complete = (id: string) => {
      const reduced = prefersReducedMotion();
      checkedStore.set(id, true, !reduced);
      track(id, completeAsync({ id, delay: reduced ? 0 : COMPLETE_ANIMATION_MS }));
    };
    const reopen = (id: string) => {
      checkedStore.set(id, false, false);
      reopenMutate({ id });
    };
    return {
      complete,
      reopen,
      toggle: (id) => {
        const task = findCachedTask(client, workspaceId, id);
        if (!task || task.localStatus) return;
        if (task.completedAt === null) complete(id);
        else reopen(id);
      },
      remove: (id, opts = {}) => track(id, removeAsync({ id, moveFocus: opts.moveFocus ?? focusIsInRow(id) })),
      update: (id, patch) => updateAsync({ id, patch }),
    };
  }, [client, workspaceId, completeAsync, reopenMutate, removeAsync, updateAsync]);
}
