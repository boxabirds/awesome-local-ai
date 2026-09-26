import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CREATE_TASK_TIMEOUT_MS, TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Counts, Task, TaskList } from '@todoodle/shared/schemas';
import { useCallback, useMemo } from 'react';
import { ApiError, GoneError, createTask as postTask } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { QuickAddTarget } from './DestinationChip';
import type { NewTaskInput } from './QuickAdd';
import {
  LOCAL_VERSION,
  type LocalStatus,
  type LocalTask,
  adjustCount,
  appendOptimistic,
  markStatus,
  removeLocal,
  replaceWithServer,
} from './taskCache';

type CreateVars = { id: string; name: string; description: string; list: TaskList; retry: boolean };

/** The list a quick-add target writes into. Stories 7 and 8 map their targets here. */
function listFor(target: QuickAddTarget): TaskList {
  switch (target.kind) {
    default:
      return 'inbox';
  }
}

/**
 * Todoodle refused the content (400 validation, 409 id_conflict, 410 gone): retrying can't succeed, so
 * the row is `rejected`. Anything else (network, timeout, 5xx, 403, 404, offline) may be temporary: `failed`.
 */
export function outcomeOf(error: unknown): Extract<LocalStatus, 'failed' | 'rejected'> {
  if (error instanceof GoneError) return 'rejected';
  if (error instanceof ApiError && (error.status === 400 || error.status === 409)) return 'rejected';
  return 'failed';
}

/** An AbortSignal that fires after `ms` (setTimeout based, so it follows fake timers in tests). */
function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('The create request timed out', 'TimeoutError')), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function nextSortOrder(list: LocalTask[] | undefined): number {
  const last = list?.reduce((max, task) => Math.max(max, task.sortOrder), 0) ?? 0;
  return last + TASK_SORT_STEP;
}

/**
 * Optimistic task creation. The row shows at once (pending, aria-busy), the count goes up, and the POST
 * carries the client-generated id. On 201/200 the row is replaced in place by the server's task; on
 * failure it stays with its text (failed: Retry + Discard; rejected: Discard) and the count goes back.
 * Retry resends the SAME id and body, so a lost response never makes a duplicate. No automatic retry.
 * Cache writes happen only in onMutate, onSuccess and onError.
 */
export function useCreateTask(workspaceId: string) {
  const queryClient = useQueryClient();

  const { mutate } = useMutation<Task, unknown, CreateVars>({
    mutationKey: [...queryKeys.root(workspaceId), 'createTask'],
    mutationFn: async ({ id, name, description }) => {
      const timeout = timeoutSignal(CREATE_TASK_TIMEOUT_MS);
      try {
        return await postTask(workspaceId, { id, name, description }, timeout.signal);
      } finally {
        timeout.clear();
      }
    },
    onMutate: (vars) => {
      const key = queryKeys.tasks(workspaceId, { list: vars.list });
      queryClient.setQueryData<LocalTask[]>(key, (list) =>
        vars.retry
          ? markStatus(list, vars.id, 'pending')
          : appendOptimistic(list, {
              id: vars.id,
              workspaceId,
              name: vars.name,
              description: vars.description,
              sortOrder: nextSortOrder(list),
              completedAt: null,
              version: LOCAL_VERSION,
              createdAt: '',
              updatedAt: '',
            }),
      );
      queryClient.setQueriesData<Counts>({ queryKey: queryKeys.counts(workspaceId) }, (counts) => adjustCount(counts, 1));
    },
    onSuccess: (task, vars) => {
      queryClient.setQueryData<LocalTask[]>(queryKeys.tasks(workspaceId, { list: vars.list }), (list) => replaceWithServer(list, task));
    },
    onError: (error, vars) => {
      queryClient.setQueryData<LocalTask[]>(queryKeys.tasks(workspaceId, { list: vars.list }), (list) =>
        markStatus(list, vars.id, outcomeOf(error)),
      );
      queryClient.setQueriesData<Counts>({ queryKey: queryKeys.counts(workspaceId) }, (counts) => adjustCount(counts, -1));
    },
  });

  const createTask = useCallback(
    (input: NewTaskInput) =>
      mutate({ id: input.id, name: input.name, description: input.description, list: listFor(input.target), retry: false }),
    [mutate],
  );

  const findLocal = useCallback(
    (id: string): { task: LocalTask; list: TaskList } | null => {
      for (const [key, data] of queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(workspaceId) })) {
        const task = data?.find((item) => item.id === id);
        const filter = key[3] as { list: TaskList } | undefined;
        if (task && filter) return { task, list: filter.list };
      }
      return null;
    },
    [queryClient, workspaceId],
  );

  const retry = useCallback(
    (id: string) => {
      const found = findLocal(id);
      if (found?.task.localStatus !== 'failed') return;
      const { task, list } = found;
      mutate({ id, name: task.name, description: task.description, list, retry: true });
    },
    [findLocal, mutate],
  );

  const discard = useCallback(
    (id: string) => {
      const found = findLocal(id);
      if (!found || found.task.localStatus === undefined || found.task.localStatus === 'pending') return;
      queryClient.setQueryData<LocalTask[]>(queryKeys.tasks(workspaceId, { list: found.list }), (list) => removeLocal(list, id));
    },
    [findLocal, queryClient, workspaceId],
  );

  return useMemo(() => ({ createTask, retry, discard }), [createTask, retry, discard]);
}
