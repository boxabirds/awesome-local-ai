import { type QueryClient, notifyManager } from '@tanstack/react-query';
import { LIVE_CLOSE_NOT_FOUND, LIVE_PAUSED_AFTER_MS, LIVE_PING, LIVE_PING_INTERVAL_MS, LIVE_PONG } from '@todoodle/shared/limits';
import { queryKeys } from '@/lib/queryKeys';
import { backoffDelay } from './backoff';
import { dispatchEvent } from './dispatch';
import { scheduleFrame } from './frameScheduler';

/** 'connecting' until the first open; 'reconnecting' from any drop until the next open; 'not_found' is terminal. */
export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'not_found';

export type LiveSnapshot = {
  readonly status: SocketStatus;
  /** Connecting or reconnecting continuously for at least LIVE_PAUSED_AFTER_MS (shows the Reconnecting pill). */
  readonly pausedLong: boolean;
};

export type NetworkStatus = 'online' | 'offline';

/** What the connection needs from the NetworkMonitor. */
export type NetworkSource = { subscribe(listener: () => void): () => void; getSnapshot(): NetworkStatus };

export type SocketFactory = (url: string) => WebSocket;

let defaultSocketFactory: SocketFactory = (url) => new WebSocket(url);

/** Test hook: how every LiveConnection without an explicit factory creates its socket. */
export function setDefaultSocketFactory(factory: SocketFactory): void {
  defaultSocketFactory = factory;
}

export type LiveConnectionOptions = {
  workspaceId: string;
  queryClient: QueryClient;
  network?: NetworkSource;
  createSocket?: SocketFactory;
  /** Jitter source for the reconnect backoff. */
  random?: () => number;
  /**
   * Browsers hide the HTTP status of a refused upgrade. After a socket fails without ever opening this is
   * asked whether the workspace still opens: false (a 404) means not_found. A rejection means unknown.
   */
  checkExists?: () => Promise<boolean>;
  /** Applies one parsed frame. Defaults to dispatchEvent for this workspace. */
  dispatch?: (frame: unknown) => void;
  /** Schedules a batch flush. Defaults to the next animation frame (setTimeout while hidden). */
  scheduleFlush?: (flush: () => void) => void;
  url?: string;
};

function liveUrl(workspaceId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/w/${encodeURIComponent(workspaceId)}/live`;
}

/**
 * The one live socket for a workspace (a plain class outside React). Owns the socket, the reconnect
 * backoff, the heartbeat, the pausedLong timer and the per-frame batch queue, and exposes its status
 * through subscribe/getSnapshot. Losing the socket never means offline: saving goes over HTTP.
 */
export class LiveConnection {
  readonly workspaceId: string;
  private readonly queryClient: QueryClient;
  private readonly network?: NetworkSource;
  private readonly createSocket: SocketFactory;
  private readonly random: () => number;
  private readonly checkExists?: () => Promise<boolean>;
  private readonly dispatch: (frame: unknown) => void;
  private readonly scheduleFlush: (flush: () => void) => void;
  private readonly url: string;

  private snapshot: LiveSnapshot = { status: 'connecting', pausedLong: false };
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private active = false;
  private attempt = 0;
  /** Set by any drop: the next open refetches what the socket may have missed. */
  private needsHeal = false;
  private awaitingPong = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private queue: unknown[] = [];
  private flushScheduled = false;
  private unsubscribeNetwork: (() => void) | null = null;
  private lastNetwork: NetworkStatus = 'online';

  constructor(options: LiveConnectionOptions) {
    this.workspaceId = options.workspaceId;
    this.queryClient = options.queryClient;
    this.network = options.network;
    this.createSocket = options.createSocket ?? ((url) => defaultSocketFactory(url));
    this.random = options.random ?? Math.random;
    this.checkExists = options.checkExists;
    this.dispatch =
      options.dispatch ?? ((frame) => dispatchEvent({ queryClient: this.queryClient, workspaceId: this.workspaceId }, frame));
    this.scheduleFlush = options.scheduleFlush ?? scheduleFrame;
    this.url = options.url ?? liveUrl(options.workspaceId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSnapshot => this.snapshot;

  /** Starts connecting. Idempotent; can be called again after disconnect(). */
  connect(): void {
    if (this.active || this.snapshot.status === 'not_found') return;
    this.active = true;
    if (this.snapshot.status === 'open') {
      // Reconnecting after disconnect(): anything missed in between is refetched on open.
      this.needsHeal = true;
      this.setSnapshot({ status: 'reconnecting', pausedLong: false });
    }
    if (this.network) {
      this.lastNetwork = this.network.getSnapshot();
      this.unsubscribeNetwork = this.network.subscribe(this.onNetworkChange);
    }
    this.startPausedTimer();
    if (this.lastNetwork === 'offline') return; // Connects when the network comes back.
    this.openSocket();
  }

  /** Closes the socket and stops every timer. */
  disconnect(): void {
    this.active = false;
    this.clearTimers();
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
    this.queue = [];
    const socket = this.detachSocket();
    closeQuietly(socket, 1000);
  }

  private setSnapshot(next: LiveSnapshot): void {
    if (next.status === this.snapshot.status && next.pausedLong === this.snapshot.pausedLong) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private openSocket(): void {
    this.reconnectTimer = null;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    let opened = false;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      opened = true;
      this.onOpen();
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.onMessage(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onDropped(event.code, opened);
    });
  }

  private onOpen(): void {
    this.attempt = 0;
    this.clearPausedTimer();
    this.setSnapshot({ status: 'open', pausedLong: false });
    if (this.needsHeal) {
      this.needsHeal = false;
      void this.queryClient.invalidateQueries({ queryKey: queryKeys.root(this.workspaceId) });
    }
    this.startHeartbeat();
  }

  private onMessage(data: unknown): void {
    this.awaitingPong = false;
    if (data === LIVE_PONG) return;
    let frame: unknown = data;
    if (typeof data === 'string') {
      try {
        frame = JSON.parse(data);
      } catch {
        // Left as the raw string: dispatch rejects and warns.
      }
    }
    this.queue.push(frame);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.scheduleFlush(this.flush);
  }

  /** Applies every queued frame in one notifyManager batch: a burst notifies each observer once. */
  private flush = (): void => {
    this.flushScheduled = false;
    const frames = this.queue;
    this.queue = [];
    if (!this.active) return;
    notifyManager.batch(() => {
      for (const frame of frames) this.dispatch(frame);
    });
  };

  private onDropped(code: number, opened: boolean): void {
    this.stopHeartbeat();
    if (!this.active) return;
    if (code === LIVE_CLOSE_NOT_FOUND) {
      this.toNotFound();
      return;
    }
    this.needsHeal = true;
    this.setSnapshot({ status: 'reconnecting', pausedLong: this.snapshot.pausedLong });
    this.startPausedTimer();
    if (!opened && this.checkExists) {
      this.checkExists().then(
        (exists) => (exists || !this.active ? this.scheduleReconnect() : this.toNotFound()),
        () => this.scheduleReconnect(),
      );
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.active || this.snapshot.status === 'not_found' || this.socket || this.reconnectTimer) return;
    // Offline: wait for the network to come back instead of retrying into the void.
    if (this.lastNetwork === 'offline') return;
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private toNotFound(): void {
    this.clearTimers();
    closeQuietly(this.detachSocket(), 1000);
    this.setSnapshot({ status: 'not_found', pausedLong: false });
  }

  /** Drops the current socket as if it had closed (heartbeat timeout, network offline). */
  private dropSocket(): void {
    const socket = this.detachSocket();
    if (!socket) return;
    closeQuietly(socket, 4000);
    this.onDropped(1006, true);
  }

  private onNetworkChange = (): void => {
    const status = this.network?.getSnapshot() ?? 'online';
    if (status === this.lastNetwork) return;
    this.lastNetwork = status;
    if (!this.active || this.snapshot.status === 'not_found') return;
    if (status === 'offline') {
      this.clearReconnectTimer();
      this.dropSocket();
      if (this.snapshot.status !== 'reconnecting' && this.snapshot.status !== 'connecting') {
        this.setSnapshot({ status: 'reconnecting', pausedLong: this.snapshot.pausedLong });
      }
      return;
    }
    // Back online: try at once, with a fresh backoff.
    if (!this.socket) {
      this.clearReconnectTimer();
      this.attempt = 0;
      this.openSocket();
    }
  };

  /** Pings once at open (the pong proves the whole path) and then every LIVE_PING_INTERVAL_MS. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendPing();
    this.pingTimer = setInterval(() => {
      if (!this.socket) return;
      if (this.awaitingPong) {
        // No pong within one interval: the socket is dead even if it never reported closing.
        this.dropSocket();
        return;
      }
      this.sendPing();
    }, LIVE_PING_INTERVAL_MS);
  }

  private sendPing(): void {
    this.awaitingPong = true;
    try {
      this.socket?.send(LIVE_PING);
    } catch {
      this.dropSocket();
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.awaitingPong = false;
  }

  private startPausedTimer(): void {
    if (this.pausedTimer !== null || this.snapshot.pausedLong) return;
    this.pausedTimer = setTimeout(() => {
      this.pausedTimer = null;
      if (this.snapshot.status === 'connecting' || this.snapshot.status === 'reconnecting') {
        this.setSnapshot({ status: this.snapshot.status, pausedLong: true });
      }
    }, LIVE_PAUSED_AFTER_MS);
  }

  private clearPausedTimer(): void {
    if (this.pausedTimer !== null) clearTimeout(this.pausedTimer);
    this.pausedTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearPausedTimer();
    this.stopHeartbeat();
  }

  private detachSocket(): WebSocket | null {
    const socket = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    return socket;
  }
}

function closeQuietly(socket: WebSocket | null, code: number): void {
  if (!socket) return;
  try {
    socket.close(code);
  } catch {
    // Already closing or closed.
  }
}
