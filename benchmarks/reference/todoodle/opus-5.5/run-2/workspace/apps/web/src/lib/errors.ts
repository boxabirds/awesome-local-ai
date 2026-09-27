import { toast } from 'sonner';
import { queryClient } from './queryClient';

/**
 * A failed API call. Carries only the error code and HTTP status (0 when nothing was answered):
 * never the request body, URL fragment or any secret.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`API request failed: ${code} (${status})`);
    this.name = 'ApiError';
  }
}

/** The request never got an answer (fetch rejected): Todoodle can't be reached. */
export class NetworkError extends ApiError {
  constructor() {
    super('network', 0);
    this.name = 'NetworkError';
  }
}

/** Refused before sending: editing is off (offline), so the change could not be saved. */
export class OfflineError extends ApiError {
  constructor() {
    super('offline', 0);
    this.name = 'OfflineError';
  }
}

/** HTTP 410: the thing being changed was deleted by someone else. */
export class GoneError extends ApiError {
  constructor() {
    super('gone', 410);
    this.name = 'GoneError';
  }
}

/** True for answers that mean "no such workspace" (404, or 400 for a malformed open request). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

/**
 * For a mutation's onError: rolls back the optimistic update and, when the entity was deleted by
 * someone else (410), removes it from every workspace cache and says so. The edit is never
 * applied. Returns true when it handled a deletion.
 */
export function handleMutationError(
  error: unknown,
  { key, entityLabel, rollback }: { key: string; entityLabel: string; rollback?: () => void },
): boolean {
  rollback?.();
  if (!(error instanceof GoneError)) return false;
  const entityId = key.slice(key.indexOf(':') + 1);
  removeEntityFromCaches(entityId);
  toast(`This ${entityLabel} was deleted`, { id: `gone:${key}` });
  return true;
}

function hasId(value: unknown, id: string): boolean {
  return typeof value === 'object' && value !== null && (value as { id?: unknown }).id === id;
}

/** Drops the entity from every ['ws', ...] cache: list entries are filtered, detail entries removed. */
function removeEntityFromCaches(entityId: string): void {
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: ['ws'] })) {
    if (hasId(data, entityId)) {
      queryClient.removeQueries({ queryKey, exact: true });
    } else if (Array.isArray(data) && data.some((item) => hasId(item, entityId))) {
      queryClient.setQueryData(queryKey, data.filter((item) => !hasId(item, entityId)));
    }
  }
}
