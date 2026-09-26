import { useSyncExternalStore } from 'react';
import { setConnectivityHooks } from '@/lib/api';
import { deriveLiveUi } from './deriveLiveUi';
import type { LiveSnapshot, NetworkSource } from './LiveConnection';
import { networkMonitor } from './network';

type ConnectionSource = { subscribe(listener: () => void): () => void; getSnapshot(): LiveSnapshot };

/**
 * The edit gate as a boolean store (architecture §12): derived from the network and the current
 * workspace's socket, and subscribers are notified only when the boolean flips.
 */
export class CanEditStore {
  private readonly network: NetworkSource;
  private connection: ConnectionSource | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private value: boolean;

  constructor(network: NetworkSource) {
    this.network = network;
    this.value = this.compute();
    network.subscribe(this.recompute);
  }

  /** The workspace's live connection (LiveProvider), or null. Returns a function that detaches it. */
  setConnection(connection: ConnectionSource | null): () => void {
    this.unsubscribeConnection?.();
    this.connection = connection;
    this.unsubscribeConnection = connection?.subscribe(this.recompute) ?? null;
    this.recompute();
    return () => {
      if (this.connection === connection) this.setConnection(null);
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.value;

  private compute(): boolean {
    const socket = this.connection?.getSnapshot() ?? { status: 'open', pausedLong: false };
    return deriveLiveUi(socket.status, socket.pausedLong, this.network.getSnapshot()).canEdit;
  }

  private recompute = (): void => {
    const next = this.compute();
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  };
}

export const canEditStore = new CanEditStore(networkMonitor);

// Guard for any control the fieldset misses: workspace edits are rejected, unsent, while !canEdit.
setConnectivityHooks({ canMutate: canEditStore.getSnapshot });

/** Whether workspace editing is available. Re-renders only when it flips. */
export function useCanEdit(): boolean {
  return useSyncExternalStore(canEditStore.subscribe, canEditStore.getSnapshot);
}
