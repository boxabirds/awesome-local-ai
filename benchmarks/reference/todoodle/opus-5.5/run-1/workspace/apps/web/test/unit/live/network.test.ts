import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanEditStore } from '@/features/live/canEdit';
import type { LiveSnapshot, NetworkStatus } from '@/features/live/LiveConnection';
import { NetworkMonitor, networkMonitor } from '@/features/live/network';
import { ApiError, NetworkError, getWorkspace } from '@/lib/api';
import { WS_ID } from '../../support/liveFixtures.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  networkMonitor.resetForTests();
  vi.useRealTimers();
});

/** A probe that answers from a script: true = 200, false = failure. */
function scriptedProbe(results: boolean[]) {
  return vi.fn(async () => {
    const ok = results.shift();
    if (!ok) throw new NetworkError();
  });
}

describe('live.connection_status: NetworkMonitor', () => {
  it('TC-O13 a request whose fetch rejects (TypeError) flips the app offline', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(networkMonitor.getSnapshot()).toBe('online');
    await expect(getWorkspace(WS_ID)).rejects.toBeInstanceOf(NetworkError);
    expect(networkMonitor.getSnapshot()).toBe('offline');
  });

  it('TC-O13 an HTTP 500 (or 404) is a normal error and the app stays online', async () => {
    for (const status of [500, 404]) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ error: 'internal', message: 'x' }, { status }))));
      const error = await getWorkspace(WS_ID).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(NetworkError);
      expect(networkMonitor.getSnapshot()).toBe('online');
    }
  });

  it('TC-O14 offline, backoff probes fail, fail, ok -> offline, offline, online; recovery listeners called once; 3 probes', async () => {
    const probe = scriptedProbe([false, false, true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: true, random: () => 0.5 });
    const recovered = vi.fn();
    monitor.onRecover(recovered);
    monitor.reportNetworkFailure();
    expect(monitor.getSnapshot()).toBe('offline');

    await vi.advanceTimersByTimeAsync(1_000); // attempt 0: 1 s
    expect(probe).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot()).toBe('offline');
    await vi.advanceTimersByTimeAsync(2_000); // attempt 1: 2 s
    expect(probe).toHaveBeenCalledTimes(2);
    expect(monitor.getSnapshot()).toBe('offline');
    await vi.advanceTimersByTimeAsync(4_000); // attempt 2: 4 s
    expect(probe).toHaveBeenCalledTimes(3);
    expect(monitor.getSnapshot()).toBe('online');
    expect(recovered).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(3); // no probing while online
  });

  it('TC-O15 offline, window online event -> probe issued at once; online on 200', async () => {
    const probe = scriptedProbe([true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: true, random: () => 0.5 });
    monitor.handleOffline();
    expect(monitor.getSnapshot()).toBe('offline');
    monitor.handleOnline();
    expect(probe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe('online');
  });

  it('TC-O16 navigator.onLine false at start -> offline with exactly one probe scheduled', async () => {
    const probe = scriptedProbe([true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: false, random: () => 0.5 });
    expect(monitor.getSnapshot()).toBe('offline');
    expect(probe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(probe).toHaveBeenCalledOnce();
    expect(monitor.getSnapshot()).toBe('online');
  });

  it('a window online event while online sends no probe', () => {
    const probe = scriptedProbe([true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: true });
    monitor.handleOnline();
    expect(probe).not.toHaveBeenCalled();
  });

  it('the health probe itself never reports a network failure (no loop)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const { health } = await import('@/lib/api');
    await expect(health()).rejects.toBeInstanceOf(NetworkError);
    expect(networkMonitor.getSnapshot()).toBe('online');
  });
});

/** A hand-driven source with the subscribe/getSnapshot shape. */
function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('live.connection_status: canEdit store', () => {
  it('TC-O17 online; socket open -> reconnecting -> open notifies a canEdit subscriber zero times', () => {
    const network = source<NetworkStatus>('online');
    const socket = source<LiveSnapshot>({ status: 'open', pausedLong: false });
    const store = new CanEditStore(network);
    store.setConnection(socket);
    const listener = vi.fn();
    store.subscribe(listener);

    socket.set({ status: 'reconnecting', pausedLong: false });
    socket.set({ status: 'reconnecting', pausedLong: true });
    socket.set({ status: 'open', pausedLong: false });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(true);
  });

  it('flips (and notifies once each way) when the network goes offline and back, or the workspace is not found', () => {
    const network = source<NetworkStatus>('online');
    const socket = source<LiveSnapshot>({ status: 'open', pausedLong: false });
    const store = new CanEditStore(network);
    const detach = store.setConnection(socket);
    const listener = vi.fn();
    store.subscribe(listener);

    network.set('offline');
    expect(store.getSnapshot()).toBe(false);
    network.set('online');
    expect(store.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    socket.set({ status: 'not_found', pausedLong: false });
    expect(store.getSnapshot()).toBe(false);
    detach();
    expect(store.getSnapshot()).toBe(true);
  });
});
