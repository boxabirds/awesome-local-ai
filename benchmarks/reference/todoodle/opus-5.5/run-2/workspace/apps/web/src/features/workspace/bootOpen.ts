import { type OpenResult, openWorkspace } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

/*
 * Opening a workspace from its link. The open call deliberately has no query key: it runs before
 * the id is known, and a key would put the secret into the query cache and devtools. Everything
 * here lives in module memory only (never in web storage or history state).
 */

let boot: { secret: string; promise: Promise<OpenResult> } | null = null;
const opens = new Map<string, Promise<OpenResult>>();
const workspaceIdBySecret = new Map<string, string>();

/** Remembers (in memory) which workspace a secret opened, so a later visit renders from cache. */
export function rememberSecretWorkspace(secret: string, workspaceId: string): void {
  workspaceIdBySecret.set(secret, workspaceId);
}

/** The workspace id this secret is already known to open in this page session, if any. */
export function knownWorkspaceId(secret: string): string | undefined {
  return workspaceIdBySecret.get(secret);
}

/** POST open, then (in the fetch continuation) prime the workspace query. */
function openAndPrime(secret: string): Promise<OpenResult> {
  const promise = openWorkspace(secret).then((result) => {
    queryClient.setQueryData(queryKeys.workspace(result.workspace.id), result.workspace);
    rememberSecretWorkspace(secret, result.workspace.id);
    return result;
  });
  // The route observes failures through use(); this keeps an unobserved failure quiet.
  promise.catch(() => {});
  return promise;
}

/**
 * Called once from main.tsx before render. On /w with a non-empty hash it fires the open request
 * immediately, in parallel with the Workspace route chunk download.
 */
export function startBootOpen(location: Pick<Location, 'pathname' | 'hash'>): Promise<OpenResult> | null {
  const secret = location.hash.slice(1);
  if (location.pathname !== '/w' || !secret) return null;
  boot = { secret, promise: openAndPrime(secret) };
  return boot.promise;
}

/** The boot open for this secret (the same promise every call), or null for any other secret. */
export function takeBootOpen(secret: string): Promise<OpenResult> | null {
  return boot?.secret === secret ? boot.promise : null;
}

/**
 * The open the Workspace route suspends on: the boot open when it matches, otherwise one shared
 * open per secret, so re-renders and StrictMode reuse it instead of sending another request.
 */
export function openForRoute(secret: string): Promise<OpenResult> {
  const existing = takeBootOpen(secret) ?? opens.get(secret);
  if (existing) return existing;
  const promise = openAndPrime(secret);
  opens.set(secret, promise);
  return promise;
}

/** Try again: forget the failed open for this secret so the next openForRoute sends a new one. */
export function discardOpen(secret: string): void {
  if (boot?.secret === secret) boot = null;
  opens.delete(secret);
}

/** Test hook: forget every open made so far. */
export function resetBootOpenForTests(): void {
  boot = null;
  opens.clear();
  workspaceIdBySecret.clear();
}
