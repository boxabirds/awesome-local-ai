import { CREATE_TASK_TIMEOUT_MS } from '@todoodle/shared/limits';
import type { Counts, Task, TaskList } from '@todoodle/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createTask as postTask } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import type { QuickAddTarget } from './DestinationChip';
import type { LocalStatus, LocalTask } from './localTask';
import type { NewTaskInput } from './QuickAdd';
import { insertBySortOrder, placeTask } from './cacheOps';
import { adjustCount, appendOptimistic, markStatus, nextSortOrder, removeLocal, replaceWithServer } from './taskCache';

type CreateVariables = NewTaskInput & { retry?: boolean };

/** The list a new task shows in (story 5: always the Inbox; stories 7 and 8 add theirs). */
function listFor(_target: QuickAddTarget): TaskList {
  return 'inbox';
}

/** 400, 409 and 410: the server refused the content, so retrying can't help (Discard only). */
function outcomeOf(error: unknown): LocalStatus {
  return error instanceof ApiError && (error.status === 400 || error.status === 409 || error.status === 410) ? 'rejected' : 'failed';
}

/** Aborts after `ms` (a plain timer, so it follows fake timers in tests). */
function timeoutSignal(ms: number): { signal: AbortSignal; clear(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Task create timed out', 'TimeoutError')), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export type CreateTaskApi = {
  createTask(input: NewTaskInput): void;
  /** Failed rows only: sends the SAME id and body again. */
  retry(id: string): void;
  /** Removes an unsaved row. No request. */
  discard(id: string): void;
};

/**
 * Optimistic task creation. The row shows at once (saving), then becomes the server's task, or
 * stays with its text as failed (Retry, Discard) or rejected (Discard). No automatic retry: the
 * user decides. Cache writes happen only in onMutate, onSuccess and onError.
 */
export function useCreateTask(workspaceId: string): CreateTaskApi {
  const queryClient = useQueryClient();
  const withCompleted = (target: QuickAddTarget) => qk.tasks(workspaceId, { list: listFor(target), includeCompleted: true });

  const { mutate } = useMutation<Task, unknown, CreateVariables>({
    mutationKey: [...qk.root(workspaceId), 'create-task'],
    mutationFn: async ({ id, name, description }) => {
      const timeout = timeoutSignal(CREATE_TASK_TIMEOUT_MS);
      try {
        return await postTask(workspaceId, { id, name, description }, timeout.signal);
      } finally {
        timeout.clear();
      }
    },
    onMutate: (vars) => {
      const key = qk.tasks(workspaceId, { list: listFor(vars.target) });
      const optimistic = (list: readonly LocalTask[] | undefined): LocalTask => ({
        id: vars.id,
        workspaceId,
        name: vars.name,
        description: vars.description,
        sortOrder: nextSortOrder(list),
        completedAt: null,
        version: 0,
        createdAt: '',
        updatedAt: '',
        localStatus: 'pending',
      });
      const open = queryClient.getQueryData<LocalTask[]>(key);
      queryClient.setQueryData<LocalTask[]>(key, (list) =>
        vars.retry ? markStatus(list, vars.id, 'pending') : appendOptimistic(list, optimistic(list)),
      );
      // Story 6: the same list with its completed tasks, when cached (the new task goes before them).
      queryClient.setQueryData<LocalTask[]>(withCompleted(vars.target), (list) =>
        !list ? list : vars.retry ? markStatus(list, vars.id, 'pending') : insertBySortOrder(list, optimistic(open ?? list.filter((t) => !t.completedAt))),
      );
      queryClient.setQueriesData<Counts>({ queryKey: qk.counts(workspaceId) }, (counts) => adjustCount(counts, 1));
    },
    onSuccess: (task, vars) => {
      queryClient.setQueryData<LocalTask[]>(qk.tasks(workspaceId, { list: listFor(vars.target) }), (list) => replaceWithServer(list, task));
      queryClient.setQueryData<LocalTask[]>(withCompleted(vars.target), (list) => placeTask(list, task, true));
    },
    onError: (error, vars) => {
      queryClient.setQueryData<LocalTask[]>(qk.tasks(workspaceId, { list: listFor(vars.target) }), (list) =>
        markStatus(list, vars.id, outcomeOf(error)),
      );
      queryClient.setQueryData<LocalTask[]>(withCompleted(vars.target), (list) => markStatus(list, vars.id, outcomeOf(error)));
      queryClient.setQueriesData<Counts>({ queryKey: qk.counts(workspaceId) }, (counts) => adjustCount(counts, -1));
    },
  });

  return useMemo<CreateTaskApi>(() => {
    const findLocal = (id: string): { task: LocalTask; list: TaskList } | null => {
      for (const list of ['inbox'] as const) {
        const task = queryClient.getQueryData<LocalTask[]>(qk.tasks(workspaceId, { list }))?.find((t) => t.id === id);
        if (task) return { task, list };
      }
      return null;
    };
    return {
      createTask: (input) => mutate(input),
      retry: (id) => {
        const found = findLocal(id);
        if (found?.task.localStatus !== 'failed') return;
        const { task } = found;
        mutate({ id, name: task.name, description: task.description, target: { kind: 'inbox' }, retry: true });
      },
      discard: (id) => {
        const found = findLocal(id);
        if (!found?.task.localStatus || found.task.localStatus === 'pending') return;
        queryClient.setQueryData<LocalTask[]>(qk.tasks(workspaceId, { list: found.list }), (list) => removeLocal(list, id));
        queryClient.setQueryData<LocalTask[]>(qk.tasks(workspaceId, { list: found.list, includeCompleted: true }), (list) => removeLocal(list, id));
      },
    };
  }, [mutate, queryClient, workspaceId]);
}
