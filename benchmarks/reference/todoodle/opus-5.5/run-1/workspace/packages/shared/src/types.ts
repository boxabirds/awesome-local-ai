/**
 * Outcome of a guarded write in the API's db modules (story 6):
 * - changed: the write happened (bump version, broadcast);
 * - noop: already in the requested state, nothing written (no version bump, no broadcast);
 * - gone: the row is soft-deleted (410);
 * - missing: no such row in this workspace (404).
 */
export type MutationResult<T> = { kind: 'changed'; entity: T } | { kind: 'noop'; entity: T } | { kind: 'gone' } | { kind: 'missing' };
