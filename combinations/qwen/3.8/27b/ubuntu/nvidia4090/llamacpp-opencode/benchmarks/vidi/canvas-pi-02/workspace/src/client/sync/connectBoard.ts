import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED, MESSAGE_SYNC, MESSAGE_SYNC_ACK } from '../../shared/protocol';

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
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmedConnected'
  /**
   * The room closed the connection with CLOSE_BOARD_LOAD_FAILED (4500):
   * the board's stored state could not be loaded (damaged snapshot or
   * unreadable storage). The provider keeps retrying; the first successful
   * sync recovers to `connected` without a page reload (persist.client_status).
   */
  | 'load_failed';

/**
 * The state machine, isolated from the provider so it can be driven by a
 * fake emitter in component tests (task 7) with fake timers.
 */
export function createConnectionStateMachine(
  onState: (state: ConnectionState) => void,
): {
  getStatus(state: { status: string }): void;
  onSync(state: boolean): void;
  /**
   * Provider `connection-close` event: the server's close code, or `undefined`
   * for a local close (watchdog / our own disconnect — not a server signal).
   */
  onClose(code?: number): void;
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
      else if (phase === 'load_failed') {
        // Recovery: the retry landed, the board is readable again (design
        // state diagram: LoadFailed --> Connected). Editing re-enables here
        // without a page reload.
        setPhase('connected');
      } else if (phase === 'connecting') setPhase('connected');
    },
    onClose: (code) => {
      if (phase === 'load_failed') {
        // Sticky until a successful sync (onSync): a stray non-4500 close in
        // the retry storm must not mask the load error.
        return;
      }
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        // The room could not load the board: distinct from a transient drop.
        // The provider keeps retrying (4500 is outside y-websocket's
        // "never reconnect" band 4400-4499).
        clearConfirmation();
        setPhase('load_failed');
        return;
      }
      // 1011 (storage failure while serving — the board is readable and
      // pending changes re-send on reconnect, persist.save_failure), 1003,
      // or a plain network close: transient. A drop only matters once we
      // had been up; during the initial connect a failed open stays
      // "connecting" (the provider retries with backoff).
      if (phase === 'connected' || phase === 'confirmedConnected') {
        clearConfirmation();
        setPhase('reconnecting');
      }
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

export interface SyncAckHandlers {
  onSend(frame: ArrayBuffer | string): void;
  onAck(): void;
}

export interface ConnectBoardOptions {
  boardId: string;
  doc: Y.Doc;
  /** WebSocket base URL, e.g. 'ws://localhost:8787'. Defaults to the page origin. */
  serverUrl?: string;
  /** Story 13: handlers for the sync acknowledgement tracker. */
  syncAck?: SyncAckHandlers;
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

type ProviderOptions = NonNullable<ConstructorParameters<typeof WebsocketProvider>[3]>;
type ProviderFactory = (
  url: string,
  boardId: string,
  doc: Y.Doc,
  opts: ProviderOptions,
) => WebsocketProvider;

const defaultProviderFactory: ProviderFactory = (url, boardId, doc, opts) =>
  new WebsocketProvider(url, boardId, doc, opts);

let providerFactory: ProviderFactory = defaultProviderFactory;

/**
 * Test seam (task 7 / TC-23): substitute the provider constructor with a
 * fake emitter so component tests can drive `connection-close` / `status` /
 * `sync` events. `null` restores the real WebsocketProvider.
 */
export function setProviderFactoryForTest(factory: ProviderFactory | null): void {
  providerFactory = factory ?? defaultProviderFactory;
}

/**
 * Connect a Y.Doc to a board room over the y-websocket provider. The
 * provider handles the y-protocols handshake, exponential backoff
 * (capped at RECONNECT_MAX_BACKOFF_MS) and re-sends state on every
 * (re)connect — which is what makes "the room's doc is in memory" safe.
 */
/**
 * Handle an incoming WebSocket frame: if it's a MESSAGE_SYNC_ACK, call
 * onAck. All other frames pass through.
 */
function handleIncomingFrame(data: ArrayBuffer, ack: SyncAckHandlers): void {
  const bytes = new Uint8Array(data);
  if (bytes.length < 1) return;
  if (bytes[0] === MESSAGE_SYNC_ACK) {
    ack.onAck();
  }
}

export function connectBoard(options: ConnectBoardOptions): BoardConnection {
  const { boardId, doc } = options;
  const serverUrl = options.serverUrl ?? defaultServerUrl();
  const syncAck = options.syncAck;

  const provider = providerFactory(
    `${serverUrl.replace(/\/$/, '')}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true, // WebSocket only; no BroadcastChannel in this story
    },
  );

  // Story 13: wrap the provider's WebSocket to intercept messages for
  // sync ack counting.
  if (syncAck) {
    const origConnect = (provider as unknown as { connect: () => void }).connect;
    (provider as unknown as { connect: () => void }).connect = function () {
      origConnect.call(this);
      const socket = (provider as unknown as { socket?: WebSocket }).socket;
      if (socket && !((socket as unknown as Record<string, unknown>).__wrapped)) {
        const origOnMessage = socket.onmessage;
        socket.onmessage = (event: MessageEvent) => {
          if (typeof event.data !== 'string' && event.data instanceof ArrayBuffer) {
            handleIncomingFrame(event.data, syncAck);
          }
          if (origOnMessage) origOnMessage.call(socket, event);
        };
        const origSend = socket.send.bind(socket);
        socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
          if (typeof data !== 'string' && data instanceof ArrayBuffer) {
            syncAck.onSend(data);
          } else if (data && typeof data === 'object' && 'byteOffset' in data && 'byteLength' in data && 'buffer' in data) {
            const view = data as { byteOffset: number; byteLength: number; buffer: ArrayBuffer };
            syncAck.onSend(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
          }
          return origSend(data);
        };
        (socket as unknown as Record<string, unknown>).__wrapped = true;
      }
    };
  }

  const listeners = new Set<(phase: ConnectionState) => void>();
  const machine = createConnectionStateMachine((phase) => {
    for (const listener of listeners) listener(phase);
  });
  provider.on('status', (event: { status: string }) => machine.getStatus(event));
  provider.on('sync', (state: boolean) => machine.onSync(state));
  // Close codes carry the server's verdict on the board (persist.client_status):
  // 4500 -> load_failed (locked); anything else is a transient drop.
  provider.on('connection-close', (event: CloseEvent | null) =>
    machine.onClose(event !== null ? event.code : undefined),
  );

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
