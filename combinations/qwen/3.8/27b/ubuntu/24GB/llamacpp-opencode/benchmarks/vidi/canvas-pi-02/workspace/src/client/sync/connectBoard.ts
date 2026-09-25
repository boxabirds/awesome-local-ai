import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * The client-side connection phases (design.md "Client connection state
 * machine"). The badge maps these to visible labels; `connected` (settled)
 * is deliberately *not* shown — a quiet board means a healthy connection.
 *
 *   connecting          initial connect in flight ("Connecting…")
 *   connected           healthy, settled            (badge hidden)
 *   reconnecting        was connected, now down     ("Reconnecting…")
 *   confirmedConnected  re-synced, proving itself   ("Connected", ≤ 2s)
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmedConnected';

/**
 * The state machine, isolated from the provider so it can be driven by a
 * fake emitter in component tests (task 7) with fake timers.
 */
export function createConnectionStateMachine(
  onState: (state: ConnectionState) => void,
): {
  getStatus(state: { status: string }): void;
  onSync(state: boolean): void;
  /** Browser `offline` while up: go "Reconnecting…" at once. */
  markReconnecting(): void;
  /** Browser `online` while the provider already reports itself re-synced. */
  confirmRecovered(): void;
  getPhase(): ConnectionState;
  dispose(): void;
} {
  let phase: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const setPhase = (next: ConnectionState): void => {
    if (next === phase) return;
    phase = next;
    onState(phase);
  };

  const clearConfirmation = (): void => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  // Recovered: show "Connected" for the confirmation window, then settle hidden.
  const recover = (): void => {
    setPhase('confirmedConnected');
    clearConfirmation();
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      setPhase('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  return {
    /** Provider `status` events: {status: 'connecting'|'connected'|'disconnected'}. */
    getStatus: (event) => {
      if (event.status !== 'disconnected') return;
      // A drop only matters once we had been up; during the initial connect
      // a failed open stays "connecting" (the provider retries with backoff).
      if (phase === 'connected' || phase === 'confirmedConnected') {
        clearConfirmation();
        setPhase('reconnecting');
      }
    },
    /** Provider `sync` events: true once socket is open AND state exchanged. */
    onSync: (state) => {
      if (!state) return;
      if (phase === 'reconnecting') recover();
      else if (phase === 'connecting') setPhase('connected');
    },
    /**
     * Browser `offline` while connected: go "Reconnecting…" immediately, rather
     * than waiting for the provider's 30 s no-message watchdog to notice the
     * dead socket (the socket's own close can also lag well behind the drop).
     */
    markReconnecting: () => {
      if (phase === 'connected' || phase === 'confirmedConnected') {
        clearConfirmation();
        setPhase('reconnecting');
      }
    },
    /** Browser `online` while the provider is already re-synced. */
    confirmRecovered: () => {
      if (phase === 'reconnecting') recover();
    },
    getPhase: () => phase,
    dispose: () => clearConfirmation(),
  };
}

export interface ConnectBoardOptions {
  boardId: string;
  doc: Y.Doc;
  /** WebSocket base URL, e.g. 'ws://localhost:8787'. Defaults to the page origin. */
  serverUrl?: string;
}

export interface BoardConnection {
  readonly provider: WebsocketProvider;
  /** Current phase. */
  getPhase(): ConnectionState;
  /** Subscribe to phase changes; the current phase is delivered immediately. */
  subscribe(listener: (phase: ConnectionState) => void): () => void;
  /** Stop listening and close the socket. */
  destroy(): void;
}

function defaultServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

/**
 * Connect a Y.Doc to a board room over the y-websocket provider. The
 * provider handles the y-protocols handshake, exponential backoff
 * (capped at RECONNECT_MAX_BACKOFF_MS) and re-sends state on every
 * (re)connect — which is what makes "the room's doc is in memory" safe.
 */
export function connectBoard(options: ConnectBoardOptions): BoardConnection {
  const { boardId, doc } = options;
  const serverUrl = options.serverUrl ?? defaultServerUrl();

  const provider = new WebsocketProvider(
    `${serverUrl.replace(/\/$/, '')}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true, // WebSocket only; no BroadcastChannel in this story
    },
  );

  const listeners = new Set<(phase: ConnectionState) => void>();
  const machine = createConnectionStateMachine((phase) => {
    for (const listener of listeners) listener(phase);
  });
  provider.on('status', (event: { status: string }) => machine.getStatus(event));
  provider.on('sync', (state: boolean) => machine.onSync(state));

  // The provider only notices a dropped socket via its close handler or its
  // 30 s no-message watchdog, both of which can lag well behind the network
  // actually going down. The browser's own offline/online events are timely:
  // on `offline` go "Reconnecting…" at once; on `online` the provider's
  // backoff re-establishes and re-syncs (onSync -> confirmedConnected), unless
  // the socket survived the outage and is already synced (then settle now).
  const onOffline = (): void => machine.markReconnecting();
  const onOnline = (): void => {
    if (machine.getPhase() === 'reconnecting' && provider.synced) machine.confirmRecovered();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  return {
    provider,
    getPhase: machine.getPhase,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(machine.getPhase());
      return () => {
        listeners.delete(listener);
      };
    },
    destroy: () => {
      machine.dispose();
      listeners.clear();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      provider.destroy();
    },
  };
}
