import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from './queryKeys';

/**
 * A failed API call. Carries only the error code and HTTP status (0 when no response arrived):
 * never the request body, URL or secret, so it is safe to show or report.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`API error ${status} ${code}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** The request never got a response (fetch rejected): Todoodle can't be reached. Flips the app offline. */
export class NetworkError extends ApiError {
  constructor() {
    super('network', 0);
    this.name = 'NetworkError';
  }
}

/** A mutating call made while editing is disabled (offline): rejected before anything is sent. */
export class OfflineError extends ApiError {
  constructor() {
    super('offline', 0);
    this.name = 'OfflineError';
  }
}

/** HTTP 410 gone: the entity was deleted (by someone else) before this change reached it. */
export class GoneError extends ApiError {
  constructor() {
    super('gone', 410);
    this.name = 'GoneError';
  }
}

export function deletedMessage(entityLabel: string): string {
  return `This ${entityLabel} was deleted`;
}

/** Removes the entity with this id from every cached value under ['ws', workspaceId]. */
function removeEntityFromCaches(queryClient: QueryClient, workspaceId: string, entityId: string): void {
  for (const [queryKey, data] of queryClient.getQueriesData<unknown>({ queryKey: queryKeys.root(workspaceId) })) {
    if (Array.isArray(data)) {
      if (data.some((item) => (item as { id?: unknown } | null)?.id === entityId)) {
        queryClient.setQueryData(queryKey, data.filter((item) => (item as { id?: unknown } | null)?.id !== entityId));
      }
    } else if ((data as { id?: unknown } | null)?.id === entityId) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }
}

/**
 * Standard error handling for a failed edit (stories 5 to 8). Always rolls back the optimistic update.
 * For GoneError it also removes the entity from this workspace's caches and toasts
 * "This <label> was deleted": the edit is never applied. Returns true when it handled a GoneError.
 *
 * @example
 *   onError: (err, _vars, ctx) =>
 *     handleMutationError(err, { key: `task:${id}`, entityLabel: 'task', workspaceId, queryClient, rollback: ctx?.rollback })
 */
export function handleMutationError(
  error: unknown,
  opts: { key: string; entityLabel: string; workspaceId: string; queryClient: QueryClient; rollback?: () => void },
): boolean {
  opts.rollback?.();
  if (!(error instanceof GoneError)) return false;
  const entityId = opts.key.slice(opts.key.indexOf(':') + 1);
  removeEntityFromCaches(opts.queryClient, opts.workspaceId, entityId);
  toast(deletedMessage(opts.entityLabel), { id: `gone:${opts.key}` });
  return true;
}
