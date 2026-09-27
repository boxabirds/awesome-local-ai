import type { Mutation, QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { queryClient as appQueryClient } from '@/lib/queryClient';

/*
 * Which tasks have a change saving right now (for the row's aria-busy). One subscription to the
 * mutation cache; each row listens for its own id only. Task mutations have the key
 * ['ws', workspaceId, 'task', <operation>] and variables { id }.
 */

const busy = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
let subscribedTo: QueryClient | null = null;

function taskIdOf(mutation: Mutation<unknown, Error, unknown, unknown>): string | null {
  const key = mutation.options.mutationKey;
  if (!key || key[0] !== 'ws' || key[2] !== 'task') return null;
  const vars = mutation.state.variables as { id?: unknown } | undefined;
  return typeof vars?.id === 'string' ? vars.id : null;
}

function recompute(client: QueryClient) {
  const next = new Set<string>();
  for (const mutation of client.getMutationCache().getAll()) {
    if (mutation.state.status !== 'pending') continue;
    const id = taskIdOf(mutation);
    if (id) next.add(id);
  }
  const changed = new Set<string>();
  for (const id of busy) if (!next.has(id)) changed.add(id);
  for (const id of next) if (!busy.has(id)) changed.add(id);
  busy.clear();
  for (const id of next) busy.add(id);
  for (const id of changed) for (const listener of listeners.get(id) ?? []) listener();
}

function ensureSubscribed(client: QueryClient) {
  if (subscribedTo === client) return;
  subscribedTo = client;
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') recompute(client);
  });
}

function subscribe(id: string, listener: () => void): () => void {
  ensureSubscribed(appQueryClient);
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

/** True while a change to this task is saving. */
export function useTaskBusy(id: string): boolean {
  const sub = useCallback((listener: () => void) => subscribe(id, listener), [id]);
  return useSyncExternalStore(sub, () => busy.has(id), () => false);
}
