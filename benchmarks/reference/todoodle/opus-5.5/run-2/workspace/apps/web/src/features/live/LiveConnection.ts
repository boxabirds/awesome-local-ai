import { LIVE_CLOSE_NOT_FOUND, LIVE_PAUSED_AFTER_MS, LIVE_PING_INTERVAL_MS } from '@todoodle/shared/limits';
import { notifyManager, type QueryClient } from '@tanstack/react-query';
import { scheduleFrame as defaultScheduleFrame } from '@/lib/frameScheduler';
import { queryKeys } from '@/lib/queryKeys';
import { backoff } from './backoff';
import { type DispatchCtx, dispatchEvent } from './dispatch';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'not_found';

export type LiveSnapshot = { status: SocketStatus; pausedLong: boolean };

/** The part of the WebSocket API the connection uses (mock sockets implement it too). */
export type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
};

export type LiveConnectionOptions = {
  workspaceId: string;
  queryClient: QueryClient;
  /** Edit guards and announcer that applied events are passed to. */
  editGuard?: DispatchCtx['editGuard'];
  announcer?: DispatchCtx['announcer'];
  createSocket?: (url: string) => SocketLike;
  url?: string;
  scheduleFrame?: (callback: () => void) => void;
  random?: () => number;
  /**
   * Asked when a socket closes before it ever opened (a browser can't see the upgrade's status):
   * 'not_found' ends the connection for good.
   */
  checkAccess?: () => Promise<'ok' | 'not_found'>;
  /** Where the window `offline` event is heard (null: nowhere). */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  /** Overridable for tests; defaults to this tab's id. */
  clientId?: string;
};

export function liveUrl(workspaceId: string): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/w/${encodeURIComponent(workspaceId)}/live`;
}

/**
 * One workspace's live socket, outside React. It queues incoming frames and applies them once per
 * animation frame inside one notifyManager batch; it reconnects with backoff, keeps a heartbeat,
 * raises `pausedLong` after LIVE_PAUSED_AFTER_MS without a socket, and refetches the workspace
 * once when a dropped socket comes back. Losing the socket never means offline (that is
 * NetworkMonitor's call), so editing stays on.
 */
export class LiveConnection {
  readonly workspaceId: string;
  private readonly opts: LiveConnectionOptions;
  private snapshot: LiveSnapshot = { status: 'connecting', pausedLong: false };
  private readonly listeners = new Set<() => void>();
  private socket: SocketLike | null = null;
  private opened = false;
  private attempts = 0;
  private needsHeal = false;
  private active = false;
  private awaitingPong = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pausedTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private queue: unknown[] = [];
  private flushScheduled = false;

  constructor(opts: LiveConnectionOptions) {
    this.opts = opts;
    this.workspaceId = opts.workspaceId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSnapshot => this.snapshot;

  /** Starts (or restarts after close()) the connection. */
  connect(): void {
    if (this.active || this.snapshot.status === 'not_found') return;
    this.active = true;
    this.events()?.addEventListener('offline', this.onWindowOffline);
    this.openSocket();
  }

  /** Stops everything: socket, timers and listeners. */
  close(): void {
    this.active = false;
    this.events()?.removeEventListener('offline', this.onWindowOffline);
    clearTimeout(this.reconnectTimer);
    this.clearPausedTimer();
    this.stopHeartbeat();
    this.dropSocket(1000);
  }

  private events() {
    if (this.opts.events !== undefined) return this.opts.events;
    return typeof window === 'undefined' ? null : window;
  }

  private set(next: Partial<LiveSnapshot>) {
    const merged = { ...this.snapshot, ...next };
    if (merged.status === this.snapshot.status && merged.pausedLong === this.snapshot.pausedLong) return;
    this.snapshot = merged;
    for (const listener of this.listeners) listener();
  }

  private openSocket() {
    if (!this.active) return;
    this.set({ status: 'connecting' });
    this.startPausedTimer();
    this.opened = false;
    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as SocketLike);
    let socket: SocketLike;
    try {
      socket = create(this.opts.url ?? liveUrl(this.workspaceId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) this.onOpen();
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.onFrame(ev.data);
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.onClose(ev.code);
    };
    socket.onerror = () => {};
  }

  private onOpen() {
    this.opened = true;
    this.attempts = 0;
    this.clearPausedTimer();
    this.set({ status: 'open', pausedLong: false });
    this.startHeartbeat();
    if (this.needsHeal) {
      this.needsHeal = false;
      void this.opts.queryClient.invalidateQueries({ queryKey: queryKeys.root(this.workspaceId) });
    }
  }

  private onClose(code: number) {
    const openedBefore = this.opened;
    this.socket = null;
    this.stopHeartbeat();
    if (!this.active) return;
    if (code === LIVE_CLOSE_NOT_FOUND) {
      this.notFound();
      return;
    }
    this.scheduleReconnect();
    if (!openedBefore && this.opts.checkAccess) {
      this.opts.checkAccess().then(
        (access) => {
          if (access === 'not_found' && this.active) this.notFound();
        },
        () => {},
      );
    }
  }

  private notFound() {
    clearTimeout(this.reconnectTimer);
    this.clearPausedTimer();
    this.stopHeartbeat();
    this.dropSocket(1000);
    this.set({ status: 'not_found', pausedLong: false });
    this.events()?.removeEventListener('offline', this.onWindowOffline);
    this.active = false;
  }

  private scheduleReconnect() {
    this.needsHeal = true;
    this.set({ status: 'reconnecting' });
    this.startPausedTimer();
    clearTimeout(this.reconnectTimer);
    const delay = backoff(this.attempts++, this.opts.random);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  /** Detaches and closes the current socket without waiting for its close event. */
  private dropSocket(code: number) {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code);
    } catch {
      // Already closing.
    }
  }

  /** The socket is gone (dead heartbeat, device offline): reconnect with backoff. */
  private lose() {
    this.stopHeartbeat();
    this.dropSocket(1000);
    if (this.active) this.scheduleReconnect();
  }

  private readonly onWindowOffline = () => {
    if (this.snapshot.status === 'open' || this.snapshot.status === 'connecting') this.lose();
  };

  private startPausedTimer() {
    if (this.pausedTimer !== undefined || this.snapshot.pausedLong) return;
    this.pausedTimer = setTimeout(() => {
      this.pausedTimer = undefined;
      if (this.snapshot.status === 'connecting' || this.snapshot.status === 'reconnecting') this.set({ pausedLong: true });
    }, LIVE_PAUSED_AFTER_MS);
  }

  private clearPausedTimer() {
    clearTimeout(this.pausedTimer);
    this.pausedTimer = undefined;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.pingTimer = setInterval(() => {
      if (this.awaitingPong) {
        this.lose();
        return;
      }
      this.awaitingPong = true;
      try {
        this.socket?.send('ping');
      } catch {
        this.lose();
      }
    }, LIVE_PING_INTERVAL_MS);
  }

  private stopHeartbeat() {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.awaitingPong = false;
  }

  private onFrame(data: unknown) {
    this.awaitingPong = false;
    if (data === 'pong') return;
    this.queue.push(data);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    (this.opts.scheduleFrame ?? defaultScheduleFrame)(this.flush);
  }

  /** Applies every queued frame in one notifyManager batch (observers notified once). */
  private readonly flush = () => {
    this.flushScheduled = false;
    const frames = this.queue;
    this.queue = [];
    if (frames.length === 0) return;
    const ctx: DispatchCtx = {
      queryClient: this.opts.queryClient,
      workspaceId: this.workspaceId,
      editGuard: this.opts.editGuard,
      announcer: this.opts.announcer,
      clientId: this.opts.clientId,
    };
    notifyManager.batch(() => {
      for (const frame of frames) {
        let parsed: unknown;
        try {
          parsed = typeof frame === 'string' ? JSON.parse(frame) : frame;
        } catch {
          console.warn('Ignoring a malformed live frame');
          continue;
        }
        dispatchEvent(ctx, parsed);
      }
    });
  };
}
