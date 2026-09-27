/**
 * Outcome of a guarded single-row mutation (story 6 onwards):
 * - changed: the row was updated (version bumped); broadcast it.
 * - noop: the row was already in the requested state; nothing written, nothing broadcast.
 * - gone: the row is soft-deleted, so the mutation is refused (410).
 * - missing: no such row in this workspace (404).
 */
export type MutationResult<T> =
  | { kind: 'changed'; entity: T }
  | { kind: 'noop'; entity: T }
  | { kind: 'gone' }
  | { kind: 'missing' };
