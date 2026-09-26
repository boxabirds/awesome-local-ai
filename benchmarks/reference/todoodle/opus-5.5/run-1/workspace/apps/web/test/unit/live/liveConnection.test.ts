import { QueryClient, notifyManager } from '@tanstack/react-query';
import { LIVE_PAUSED_AFTER_MS, LIVE_PING_INTERVAL_MS } from '@todoodle/shared/limits';
import type { Workspace } from '@todoodle/shared/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceHandlers } from '@/features/live/handlers';
import { LiveConnection, type LiveConnectionOptions } from '@/features/live/LiveConnection';
import { NetworkMonitor } from '@/features/live/network';
import { clearLiveHandlersForTests } from '@/features/live/registry';
import { queryKeys } from '@/lib/queryKeys';
import { FakeSocket, OTHER_CLIENT, WS_ID, workspaceAt, workspaceUpdated } from '../../support/liveFixtures.ts';

const KEY = queryKeys.workspace(WS_ID);

let queryClient: QueryClient;
let connection: LiveConnection | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  queryClient = new QueryClient();
  registerWorkspaceHandlers();
});

afterEach(() => {
  connection?.disconnect();
  connection = undefined;
  clearLiveHandlersForTests();
  notifyManager.setScheduler((cb) => setTimeout(cb, 0));
  notifyManager.setBatchNotifyFunction((cb) => cb());
  vi.useRealTimers();
});

function connect(options: Partial<LiveConnectionOptions> = {}) {
  connection = new LiveConnection({
    workspaceId: WS_ID,
    queryClient,
    createSocket: FakeSocket.factory,
    random: () => 0.5, // no jitter
    url: 'ws://todoodle.test/api/w/x/live',
    ...options,
  });
  connection.connect();
  return connection;
}

describe('live.client_sync: per-frame batching', () => {
  it('TC-C12 50 frames before the animation frame: one batch flush, observers notified once, all 50 applied', () => {
    const frames: Array<() => void> = [];
    const scheduler = vi.fn((cb: () => void) => setTimeout(cb, 0));
    const batchNotify = vi.fn((cb: () => void) => cb());
    notifyManager.setScheduler(scheduler);
    notifyManager.setBatchNotifyFunction(batchNotify);
    queryClient.setQueryData(KEY, workspaceAt(1));
    const observed = vi.fn();
    const unsubscribe = queryClient.getQueryCache().subscribe(notifyManager.batchCalls(observed));

    const live = connect({ scheduleFlush: (flush) => frames.push(flush) });
    FakeSocket.latest().open();
    for (let version = 2; version <= 51; version++) FakeSocket.latest().receive(workspaceUpdated(version, OTHER_CLIENT));
    expect(frames).toHaveLength(1); // one flush scheduled for the whole burst
    expect(queryClient.getQueryData<Workspace>(KEY)?.version).toBe(1);

    scheduler.mockClear();
    batchNotify.mockClear();
    frames[0]!(); // the animation frame: every dispatch inside one notifyManager.batch
    expect(queryClient.getQueryData<Workspace>(KEY)).toEqual(workspaceAt(51, 'Name v51'));
    expect(scheduler).toHaveBeenCalledTimes(1); // one notification flush for all 50 updates
    vi.advanceTimersByTime(0);
    expect(batchNotify).toHaveBeenCalledTimes(1); // observers notified in a single pass
    expect(observed).toHaveBeenCalled();
    unsubscribe();
    expect(live.getSnapshot().status).toBe('open');
  });

  it('a single frame is applied on the next flush', () => {
    const frames: Array<() => void> = [];
    connect({ scheduleFlush: (flush) => frames.push(flush) });
    FakeSocket.latest().open();
    FakeSocket.latest().receive(workspaceUpdated(2, OTHER_CLIENT, 'Chores'));
    frames[0]!();
    expect(queryClient.getQueryData<Workspace>(KEY)?.name).toBe('Chores');
  });

  it('TC-C13 hidden tab: 3 frames are applied via setTimeout without any animation frame', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    connect(); // default visibility-aware scheduler
    FakeSocket.latest().open();
    for (const version of [2, 3, 4]) FakeSocket.latest().receive(workspaceUpdated(version, OTHER_CLIENT));
    vi.advanceTimersByTime(0);
    expect(queryClient.getQueryData<Workspace>(KEY)?.version).toBe(4);
    expect(raf).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('live.connection_status: socket lifecycle', () => {
  it('pausedLong boundary: 4,999 ms connecting -> false; 5,000 ms -> true', () => {
    const live = connect();
    vi.advanceTimersByTime(LIVE_PAUSED_AFTER_MS - 1);
    expect(live.getSnapshot()).toEqual({ status: 'connecting', pausedLong: false });
    vi.advanceTimersByTime(1);
    expect(live.getSnapshot()).toEqual({ status: 'connecting', pausedLong: true });
  });

  it('TC-O05 open, no pong within one interval -> socket closed, reconnecting', () => {
    const live = connect();
    const socket = FakeSocket.latest();
    socket.open();
    expect(socket.sent).toEqual(['ping']); // at once: the pong proves the path
    socket.receive('pong');
    vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
    expect(socket.sent).toEqual(['ping', 'ping']);
    socket.receive('pong');
    vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
    expect(socket.sent).toEqual(['ping', 'ping', 'ping']);
    expect(live.getSnapshot().status).toBe('open');
    // No pong this time.
    vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
    expect(socket.closedWith).not.toBeNull();
    expect(live.getSnapshot().status).toBe('reconnecting');
  });

  it('TC-O06 reconnecting + pausedLong, socket opens -> open, invalidate [ws,id] once, attempts reset, pausedLong false', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const live = connect();
    FakeSocket.latest().open();
    FakeSocket.latest().serverClose(1006);
    expect(live.getSnapshot().status).toBe('reconnecting');
    // Attempts 0..2 fail (1 s, 2 s, 4 s): pausedLong after 5 s.
    for (const wait of [1_000, 2_000]) {
      vi.advanceTimersByTime(wait);
      FakeSocket.latest().serverClose(1006);
    }
    vi.advanceTimersByTime(2_000);
    expect(live.getSnapshot()).toEqual({ status: 'reconnecting', pausedLong: true });
    vi.advanceTimersByTime(2_000); // attempt 2 fires at 4 s
    expect(FakeSocket.instances).toHaveLength(4);
    FakeSocket.latest().open();
    expect(live.getSnapshot()).toEqual({ status: 'open', pausedLong: false });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['ws', WS_ID] });

    // Attempt count reset: the next drop retries after backoff(0) = 1 s again.
    FakeSocket.latest().serverClose(1006);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(5);
  });

  it('the first open (no drop before it) does not refetch', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    connect();
    FakeSocket.latest().open();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('TC-O07 connecting, close 4404 -> not_found; no attempts over 60 s', () => {
    const live = connect();
    FakeSocket.latest().serverClose(4404);
    expect(live.getSnapshot()).toEqual({ status: 'not_found', pausedLong: false });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(live.getSnapshot().status).toBe('not_found');
  });

  it('an upgrade refused before opening + the workspace answers 404 -> not_found (never retried)', async () => {
    const checkExists = vi.fn(() => Promise.resolve(false));
    const live = connect({ checkExists });
    FakeSocket.latest().serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(checkExists).toHaveBeenCalledOnce();
    expect(live.getSnapshot().status).toBe('not_found');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('an upgrade refused before opening while the workspace still exists -> keeps retrying', async () => {
    const live = connect({ checkExists: () => Promise.resolve(true) });
    FakeSocket.latest().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(live.getSnapshot().status).toBe('reconnecting');
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('TC-O08 open + online, window offline event -> network offline and socket reconnecting; back online reconnects at once', async () => {
    const network = new NetworkMonitor({ probe: () => Promise.resolve(), initialOnline: true });
    window.addEventListener('offline', network.handleOffline);
    window.addEventListener('online', network.handleOnline);
    try {
      const live = connect({ network });
      FakeSocket.latest().open();
      window.dispatchEvent(new Event('offline'));
      expect(network.getSnapshot()).toBe('offline');
      expect(live.getSnapshot().status).toBe('reconnecting');
      expect(FakeSocket.instances[0]!.closedWith).not.toBeNull();

      // While offline no reconnect attempts are made.
      vi.advanceTimersByTime(500);
      expect(FakeSocket.instances).toHaveLength(1);

      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(network.getSnapshot()).toBe('online');
      expect(FakeSocket.instances).toHaveLength(2);
    } finally {
      window.removeEventListener('offline', network.handleOffline);
      window.removeEventListener('online', network.handleOnline);
    }
  });

  it('a socket drop never sets the network offline', () => {
    const network = new NetworkMonitor({ probe: () => Promise.resolve(), initialOnline: true });
    connect({ network });
    FakeSocket.latest().open();
    FakeSocket.latest().serverClose(1006);
    expect(network.getSnapshot()).toBe('online');
  });

  it('disconnect stops everything: no reconnects, no pausedLong', () => {
    const live = connect();
    FakeSocket.latest().serverClose(1006);
    live.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(live.getSnapshot().pausedLong).toBe(false);
  });
});
