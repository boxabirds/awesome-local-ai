import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoff } from '@/features/live/backoff';
import { canEditStore } from '@/features/live/canEdit';
import { deriveLiveUi } from '@/features/live/deriveLiveUi';
import type { SocketStatus } from '@/features/live/LiveConnection';
import { NetworkMonitor, networkMonitor } from '@/features/live/network';
import { getWorkspace, renameWorkspace } from '@/lib/api';
import { ApiError, NetworkError, OfflineError } from '@/lib/errors';
import { WS_ID } from '../live-helpers';

describe('backoff', () => {
  it('TC-O01 attempts 0, 4, 5, 50 -> 1 s, 16 s, 30 s (cap), 30 s', () => {
    const none = () => 0.5;
    expect([0, 4, 5, 50].map((n) => backoff(n, none))).toEqual([1_000, 16_000, 30_000, 30_000]);
  });

  it('TC-O02 jitter bounds: backoff(2) with random at min and max -> 3.2 s and 4.8 s', () => {
    expect(backoff(2, () => 0)).toBe(3_200);
    expect(backoff(2, () => 1)).toBe(4_800);
  });
});

describe('deriveLiveUi', () => {
  // Effective socket classes: [status, pausedLong].
  const classes: Record<string, [SocketStatus, boolean]> = {
    'connecting-short': ['connecting', false],
    open: ['open', false],
    'reconnecting-short': ['reconnecting', false],
    'paused-long': ['reconnecting', true],
    not_found: ['not_found', false],
  };
  it.each([
    ['TC-M01', 'connecting-short', 'online', { pill: false, banner: false, canEdit: true }],
    ['TC-M02', 'open', 'online', { pill: false, banner: false, canEdit: true }],
    ['TC-M03', 'reconnecting-short', 'online', { pill: false, banner: false, canEdit: true }],
    ['TC-M04', 'paused-long', 'online', { pill: true, banner: false, canEdit: true }],
    ['TC-M05', 'not_found', 'online', { pill: false, banner: false, canEdit: false }],
    ['TC-M06', 'connecting-short', 'offline', { pill: false, banner: true, canEdit: false }],
    ['TC-M07', 'open', 'offline', { pill: false, banner: true, canEdit: false }],
    ['TC-M08', 'reconnecting-short', 'offline', { pill: false, banner: true, canEdit: false }],
    ['TC-M09', 'paused-long', 'offline', { pill: false, banner: true, canEdit: false }],
    ['TC-M10', 'not_found', 'offline', { pill: false, banner: true, canEdit: false }],
  ] as const)('%s %s, %s', (_ref, socketClass, network, expected) => {
    const [status, pausedLong] = classes[socketClass]!;
    expect(deriveLiveUi(status, pausedLong, network)).toEqual(expected);
  });

  it('paused-long while connecting (never opened yet) also shows the pill', () => {
    expect(deriveLiveUi('connecting', true, 'online')).toEqual({ pill: true, banner: false, canEdit: true });
  });
});

describe('NetworkMonitor', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

  function scripted(results: boolean[]) {
    const probe = vi.fn(async () => {
      if (!results.shift()) throw new TypeError('Failed to fetch');
    });
    return probe;
  }

  it('TC-O14 offline; backoff probes fail, fail, ok -> offline, offline, online; recovery once; 3 probes', async () => {
    const probe = scripted([false, false, true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: true, events: null, random: () => 0.5 });
    const recovered = vi.fn();
    monitor.onRecovered(recovered);
    monitor.reportNetworkFailure();
    expect(monitor.getSnapshot()).toBe('offline');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot()).toBe('offline');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(monitor.getSnapshot()).toBe('offline');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(monitor.getSnapshot()).toBe('online');
    expect(recovered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(probe).toHaveBeenCalledTimes(3);
    monitor.dispose();
  });

  it('TC-O15 offline; window online event -> probe at once; online on 200', async () => {
    const events = new EventTarget();
    const probe = scripted([true]);
    const monitor = new NetworkMonitor({ probe, initialOnline: true, events });
    events.dispatchEvent(new Event('offline'));
    expect(monitor.getSnapshot()).toBe('offline');
    events.dispatchEvent(new Event('online'));
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe('online');
    monitor.dispose();
  });

  it('TC-O16 navigator.onLine false at start -> offline, one probe scheduled', async () => {
    const probe = scripted([false]);
    const monitor = new NetworkMonitor({ probe, initialOnline: false, events: null, random: () => 0.5 });
    expect(monitor.getSnapshot()).toBe('offline');
    expect(probe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(probe).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });

  it('a window online event that fails the probe stays offline', async () => {
    const events = new EventTarget();
    const monitor = new NetworkMonitor({ probe: scripted([false]), initialOnline: false, events });
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getSnapshot()).toBe('offline');
    monitor.dispose();
  });
});

describe('api.ts and the app monitor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('TC-O13 fetch rejects with TypeError -> NetworkError and offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(getWorkspace(WS_ID)).rejects.toBeInstanceOf(NetworkError);
    expect(networkMonitor.getSnapshot()).toBe('offline');
    expect(canEditStore.getSnapshot()).toBe(false);
  });

  it('TC-O13 fetch answers 500 -> ApiError, still online', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'internal', message: 'x' }, { status: 500 })));
    const error = await getWorkspace(WS_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as ApiError).status).toBe(500);
    expect(networkMonitor.getSnapshot()).toBe('online');
  });

  it('while offline a workspace edit rejects with OfflineError and sends nothing', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    networkMonitor.reset(false);
    await expect(renameWorkspace(WS_ID, 'Groceries 2')).rejects.toBeInstanceOf(OfflineError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every request carries this tab’s X-Todoodle-Client-Id', async () => {
    const fetchSpy = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({ workspace: { id: WS_ID, name: 'A', version: 1, createdAt: '' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await getWorkspace(WS_ID);
    const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Todoodle-Client-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
