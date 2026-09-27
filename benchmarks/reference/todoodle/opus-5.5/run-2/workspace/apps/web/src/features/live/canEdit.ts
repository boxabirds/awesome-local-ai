import { useSyncExternalStore } from 'react';
import { deriveLiveUi } from './deriveLiveUi';
import type { SocketStatus } from './LiveConnection';
import { type NetworkMonitor, networkMonitor } from './network';

export type CanEditStore = {
  subscribe(listener: () => void): () => void;
  /** A boolean, so subscribers are notified only when editing turns on or off. */
  getSnapshot(): boolean;
  /** The workspace connection's socket status ('open' when none is mounted). */
  setSocketStatus(status: SocketStatus): void;
};

export function createCanEditStore(network: Pick<NetworkMonitor, 'subscribe' | 'getSnapshot'>): CanEditStore {
  let socket: SocketStatus = 'open';
  const compute = () => deriveLiveUi(socket, false, network.getSnapshot()).canEdit;
  let value = compute();
  const listeners = new Set<() => void>();
  const recompute = () => {
    const next = compute();
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };
  network.subscribe(recompute);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => value,
    setSocketStatus(status) {
      socket = status;
      recompute();
    },
  };
}

/** The app's edit gate (architecture section 12): online and the workspace still exists. */
export const canEditStore = createCanEditStore(networkMonitor);

export function useCanEdit(): boolean {
  return useSyncExternalStore(canEditStore.subscribe, canEditStore.getSnapshot, canEditStore.getSnapshot);
}
