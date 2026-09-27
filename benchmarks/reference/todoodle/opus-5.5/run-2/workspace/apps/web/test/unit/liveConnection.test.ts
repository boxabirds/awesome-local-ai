import { LIVE_CLOSE_NOT_FOUND, LIVE_PAUSED_AFTER_MS, LIVE_PING_INTERVAL_MS } from '@todoodle/shared/limits';
import type { Workspace } from '@todoodle/shared/schemas';
import { notifyManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanEditStore } from '@/features/live/canEdit';
import { registerWorkspaceHandlers } from '@/features/live/handlers';
import { LiveConnection, type LiveConnectionOptions } from '@/features/live/LiveConnection';
import { NetworkMonitor } from '@/features/live/network';
import { scheduleFrame } from '@/lib/frameScheduler';
import { queryKeys } from '@/lib/queryKeys';
import { workspace } from '../fixtures';
import { FakeSocket, renameEvent, SELF_CLIENT, WS_ID } from '../live-helpers';

let queryClient: QueryClient;
let unregister: () => void;
let conn: LiveConnection | undefined;

beforeEach(() => {
  FakeSocket.all = [];
  queryClient = new QueryClient();
  unregister = registerWorkspaceHandlers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  conn?.close();
  conn = undefined;
  unregister();
  notifyManager.setScheduler(scheduleFrame);
  notifyManager.setBatchNotifyFunction((cb) => cb());
});

function connect(opts: Partial<LiveConnectionOptions> = {}) {
  conn = new LiveConnection({
    workspaceId: WS_ID,
    queryClient,
    clientId: SELF_CLIENT,
    createSocket: (url) => new FakeSocket(url),
    url: 'ws://todoodle.test/live',
    random: () => 0.5,
    events: null,
    scheduleFrame: (cb) => setTimeout(cb, 0),
    ...opts,
  });
  conn.connect();
  return conn;
}

describe('LiveConnection: frames', () => {
  it('TC-C12 50 frames before the animation frame: one batch flush, observer notified once, all 50 applied', () => {
    const frames: (() => void)[] = [];
    const scheduled: (() => void)[] = [];
    notifyManager.setScheduler((cb) => scheduled.push(cb));
    let notifyRounds = 0;
    notifyManager.setBatchNotifyFunction((cb) => {
      notifyRounds++;
      cb();
    });
    queryClient.setQueryData(queryKeys.workspace(WS_ID), workspace({ version: 1 }));
    const observer = new QueryObserver<Workspace>(queryClient, { queryKey: queryKeys.workspace(WS_ID), enabled: false });
    const seen: (string | undefined)[] = [];
    const off = observer.subscribe(notifyManager.batchCalls((result) => seen.push(result.data?.name)));
    const batch = vi.spyOn(notifyManager, 'batch');

    const c = connect({ scheduleFrame: (cb) => frames.push(cb) });
    FakeSocket.last.serverOpen();
    for (let v = 2; v <= 51; v++) FakeSocket.last.serverSend(renameEvent(`Name ${v}`, v));
    expect(frames).toHaveLength(1);
    expect(queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID))?.version).toBe(1);

    frames[0]!();
    // One outer batch around all 50 dispatches (inner cache batches nest inside it)...
    expect(batch).toHaveBeenCalled();
    expect(batch.mock.calls.filter(([fn]) => fn.toString().includes('dispatchEvent'))).toHaveLength(1);
    expect(queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID))).toMatchObject({ name: 'Name 51', version: 51 });
    // ...so exactly one scheduled flush.
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    expect(notifyRounds).toBe(1);
    expect(seen.at(-1)).toBe('Name 51');
    off();
    c.close();
  });

  it('TC-C13 hidden tab: 3 frames are applied through setTimeout without any rAF tick', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    connect({ scheduleFrame: undefined });
    FakeSocket.last.serverOpen();
    for (let v = 2; v <= 4; v++) FakeSocket.last.serverSend(renameEvent(`Hidden ${v}`, v));
    vi.advanceTimersByTime(0);
    expect(raf).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID))).toMatchObject({ name: 'Hidden 4', version: 4 });
  });

  it('visible tab: frames wait for requestAnimationFrame', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => callbacks.push(cb));
    connect({ scheduleFrame: undefined });
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverSend(renameEvent('Visible', 2));
    vi.advanceTimersByTime(100);
    expect(queryClient.getQueryData(queryKeys.workspace(WS_ID))).toBeUndefined();
    callbacks[0]!(0);
    expect(queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID))?.name).toBe('Visible');
  });
});

describe('LiveConnection: socket status', () => {
  it('connects to the live URL and reports open', () => {
    const c = connect();
    expect(c.getSnapshot()).toEqual({ status: 'connecting', pausedLong: false });
    expect(FakeSocket.last.url).toBe('ws://todoodle.test/live');
    FakeSocket.last.serverOpen();
    expect(c.getSnapshot()).toEqual({ status: 'open', pausedLong: false });
  });

  it('pausedLong: 4,999 ms without a socket -> false; 5,000 ms -> true; cleared on open', () => {
    const c = connect();
    vi.advanceTimersByTime(LIVE_PAUSED_AFTER_MS - 1);
    expect(c.getSnapshot().pausedLong).toBe(false);
    vi.advanceTimersByTime(1);
    expect(c.getSnapshot()).toEqual({ status: 'connecting', pausedLong: true });
    FakeSocket.last.serverOpen();
    expect(c.getSnapshot()).toEqual({ status: 'open', pausedLong: false });
  });

  it('TC-O05 open, no pong within the interval -> socket closed, reconnecting', () => {
    const c = connect();
    const socket = FakeSocket.last;
    socket.serverOpen();
    vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
    expect(socket.sent).toEqual(['ping']);
    expect(c.getSnapshot().status).toBe('open');
    vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
    expect(socket.closedWith).toBeDefined();
    expect(c.getSnapshot().status).toBe('reconnecting');
  });

  it('a pong keeps the socket open', () => {
    const c = connect();
    const socket = FakeSocket.last;
    socket.serverOpen();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(LIVE_PING_INTERVAL_MS);
      socket.serverSend('pong');
    }
    expect(socket.sent).toHaveLength(5);
    expect(socket.closedWith).toBeUndefined();
    expect(c.getSnapshot().status).toBe('open');
  });

  it('TC-O06 reconnecting + pausedLong, then the socket opens: open, one invalidate of [ws, id], attempts reset, pausedLong false', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const c = connect();
    FakeSocket.last.serverOpen();
    // Drop, and fail the next attempts so the backoff grows: 1 s, 2 s, 4 s.
    FakeSocket.last.serverClose(1006);
    expect(c.getSnapshot().status).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    FakeSocket.last.serverClose(1006);
    vi.advanceTimersByTime(2_000);
    FakeSocket.last.serverClose(1006);
    vi.advanceTimersByTime(4_000);
    expect(c.getSnapshot()).toEqual({ status: 'connecting', pausedLong: true });
    FakeSocket.last.serverOpen();
    expect(c.getSnapshot()).toEqual({ status: 'open', pausedLong: false });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ws', WS_ID] });
    // Attempts were reset: the next drop retries after 1 s again.
    const before = FakeSocket.all.length;
    FakeSocket.last.serverClose(1006);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all.length).toBe(before);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(before + 1);
  });

  it('the first open (no drop before it) does not refetch', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    connect();
    FakeSocket.last.serverOpen();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('TC-O07 connecting, close 4404 -> not_found; no attempts over 60 s', () => {
    const c = connect();
    FakeSocket.last.serverClose(LIVE_CLOSE_NOT_FOUND);
    expect(c.getSnapshot()).toEqual({ status: 'not_found', pausedLong: false });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(c.getSnapshot().status).toBe('not_found');
  });

  it('a socket refused before opening whose workspace answers 404 -> not_found', async () => {
    const checkAccess = vi.fn(async () => 'not_found' as const);
    const c = connect({ checkAccess });
    FakeSocket.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(checkAccess).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().status).toBe('not_found');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('TC-O08 open and online, window offline event -> network offline and socket reconnecting', () => {
    const events = new EventTarget();
    const network = new NetworkMonitor({ probe: async () => {}, initialOnline: true, events });
    const c = connect({ events });
    FakeSocket.last.serverOpen();
    events.dispatchEvent(new Event('offline'));
    expect(network.getSnapshot()).toBe('offline');
    expect(c.getSnapshot().status).toBe('reconnecting');
    network.dispose();
  });

  it('TC-O17 online canEdit subscriber: socket open -> reconnecting -> open notifies it zero times', () => {
    const network = new NetworkMonitor({ probe: async () => {}, initialOnline: true, events: null });
    const store = createCanEditStore(network);
    const listener = vi.fn();
    store.subscribe(listener);
    const c = connect();
    const sync = () => store.setSocketStatus(c.getSnapshot().status);
    c.subscribe(sync);
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverClose(1006);
    vi.advanceTimersByTime(1_000);
    FakeSocket.last.serverOpen();
    expect(c.getSnapshot().status).toBe('open');
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(true);
    // not_found does flip it.
    FakeSocket.last.serverClose(LIVE_CLOSE_NOT_FOUND);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(false);
  });
});
