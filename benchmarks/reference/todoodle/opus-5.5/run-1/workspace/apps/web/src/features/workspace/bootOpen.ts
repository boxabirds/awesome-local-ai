import type { Workspace } from '@todoodle/shared/schemas';
import { isNotFoundError, openWorkspace } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

/** Outcome of opening a workspace by its secret. Never rejects, so React's use() needs no error boundary. */
export type OpenResult =
  | { status: 'ok'; workspace: Workspace }
  | { status: 'not_found' }
  | { status: 'failed' };

/** A promise React's use() can read synchronously once settled (it checks status/value). */
type TrackedPromise<T> = Promise<T> & { status?: 'fulfilled'; value?: T };

/*
 * Open promises live in memory only. They are deliberately NOT TanStack queries: the id is unknown
 * before open resolves, and a query key would put the secret into the cache and devtools.
 */
let bootOpen: { secret: string; promise: Promise<OpenResult> } | null = null;
const opens = new Map<string, Promise<OpenResult>>();

/** The secret in a /w#<secret> location, or '' (empty hash, or not the /w route). */
export function secretFromLocation(location: Pick<Location, 'pathname' | 'hash'>): string {
  if (location.pathname !== '/w') return '';
  return location.hash.replace(/^#/, '');
}

/** Fires POST /api/workspaces/open. The then-callback writes the workspace into the query cache. */
function fireOpen(secret: string): Promise<OpenResult> {
  const promise: TrackedPromise<OpenResult> = openWorkspace(secret).then(
    ({ workspace }): OpenResult => {
      queryClient.setQueryData(queryKeys.workspace(workspace.id), workspace);
      return { status: 'ok', workspace };
    },
    (error: unknown): OpenResult => (isNotFoundError(error) ? { status: 'not_found' } : { status: 'failed' }),
  );
  void promise.then((value) => {
    promise.status = 'fulfilled';
    promise.value = value;
  });
  return promise;
}

/**
 * Called once from main.tsx before React renders. On /w with a non-empty hash it starts the open
 * request immediately, in parallel with downloading the Workspace route chunk.
 */
export function startBootOpen(location: Pick<Location, 'pathname' | 'hash'>): Promise<OpenResult> | null {
  const secret = secretFromLocation(location);
  if (!secret) return null;
  if (bootOpen?.secret !== secret) bootOpen = { secret, promise: fireOpen(secret) };
  return bootOpen.promise;
}

/** The boot promise for this secret, or null if boot opened a different secret (or nothing). */
export function takeBootOpen(secret: string): Promise<OpenResult> | null {
  return bootOpen?.secret === secret ? bootOpen.promise : null;
}

/** The open promise the /w route reads: the boot one, a primed one, or a new request (client-side navigation). */
export function getOpen(secret: string): Promise<OpenResult> {
  const existing = opens.get(secret) ?? takeBootOpen(secret);
  if (existing) return existing;
  const promise = fireOpen(secret);
  opens.set(secret, promise);
  return promise;
}

/** Try again: discards the failed result and starts a fresh open request. */
export function retryOpen(secret: string): Promise<OpenResult> {
  if (bootOpen?.secret === secret) bootOpen = null;
  const promise = fireOpen(secret);
  opens.set(secret, promise);
  return promise;
}

/** After create: the route renders at once from an already-settled result, with no open request. */
export function primeOpen(secret: string, workspace: Workspace): void {
  const value: OpenResult = { status: 'ok', workspace };
  const promise: TrackedPromise<OpenResult> = Promise.resolve(value);
  promise.status = 'fulfilled';
  promise.value = value;
  opens.set(secret, promise);
}

/** Test helper: forget every in-memory open. */
export function resetOpensForTests(): void {
  bootOpen = null;
  opens.clear();
}
