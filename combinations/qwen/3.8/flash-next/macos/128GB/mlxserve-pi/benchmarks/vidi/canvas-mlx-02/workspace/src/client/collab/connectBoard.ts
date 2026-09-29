// The browser's WebSocket + Yjs binding. Owns the y-websocket provider and maps
// its `status` / `sync` / `connection-close` events onto our small ConnectionState
// state machine. This is the ONLY module that knows about the provider; useBoardDoc
// only sees ConnectionState. The badge is HIDDEN in the steady 'connected' state,
// shown as 'confirmed' ("Connected") for CONNECTED_CONFIRMATION_MS after a
// reconnect, and shown in red as 'load_failed' when the room closed the socket
// with CLOSE_BOARD_LOAD_FAILED - the board exists but the server could not read
// it, which reconnecting alone cannot fix.
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol.ts';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  /** the room could not load this board from its storage; it keeps retrying */
  | 'load_failed';

// The subset of the y-websocket provider we depend on. WebsocketProvider matches
// this, and tests can inject a fake event emitter instead of a real socket.
export interface BoardProvider {
  on(event: 'status', cb: (s: { status: string }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  // Emitted by y-websocket just before `status: disconnected`, carrying the
  // CloseEvent - or null when we closed the socket ourselves, which is never a
  // server verdict about the board.
  on(event: 'connection-close', cb: (event: { code: number } | null) => void): void;
  off?(event: 'status', cb: (s: { status: string }) => void): void;
  off?(event: 'sync', cb: (synced: boolean) => void): void;
  off?(event: 'connection-close', cb: (event: { code: number } | null) => void): void;
  // Present on the real WebsocketProvider; used only by the test hook to force a
  // genuine socket drop/reconnect (the reconnect path then resyncs). Optional so
  // fake providers can omit them.
  connect?(): void;
  disconnect?(): void;
  destroy(): void;
}

// factory(serverUrl, roomName, doc) -> provider. Injectable for component tests.
export type ProviderFactory = (serverUrl: string, roomName: string, doc: Y.Doc) => BoardProvider;

export interface BoardConnection {
  provider: BoardProvider;
  destroy(): void;
}

// Build the WS base from the page origin: wss:// on https, ws:// otherwise
// (vite dev in the nightly e2e). y-websocket appends `/${roomName}`.
export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/rooms`;
}

const realProvider: ProviderFactory = (serverUrl, roomName, doc) =>
  new WebsocketProvider(serverUrl, roomName, doc, {
    // Bound the reconnect backoff so a brief outage reconnects within the
    // acceptance window (TC-29/30).
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Cross-tab sync is out of scope; the server is the single coordination hub.
    disableBc: true,
  });

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  makeProvider: ProviderFactory = realProvider,
): BoardConnection {
  const provider = makeProvider(defaultServerUrl(), boardId, doc);

  let state: ConnectionState = 'connecting';
  let everSynced = false; // have we ever completed a first sync?
  let reconnecting = false; // currently in a post-outage reconnect attempt?
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: ConnectionState): void => {
    if (next === state) return;
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    state = next;
    onState(next);
  };

  provider.on('connection-close', (event) => {
    // A close carrying the dedicated load-failure code is a verdict about THIS
    // board ("the server cannot read it"), not a transport problem: say so, and
    // let the provider keep retrying in the background.
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) emit('load_failed');
  });

  provider.on('status', ({ status }) => {
    // While the board is unloadable we stay on that message: the reconnect
    // attempts the provider makes in the background are not news to the user.
    if (state === 'load_failed') return;
    if (status === 'disconnected') {
      // Only a connection we previously established counts as a reconnect; a
      // socket that never synced is still "connecting".
      if (everSynced) {
        reconnecting = true;
        emit('reconnecting');
      }
    }
    // 'connecting' (a reconnect attempt) while already 'reconnecting' → no-op.
    // 'connected' means the socket is OPEN but not yet synced → wait for 'sync'.
  });

  provider.on('sync', (synced) => {
    if (!synced) return;
    if (state === 'load_failed') {
      // The room recovered and the board loaded: the message goes away. This is
      // a return to steady state, not a reconnect confirmation.
      everSynced = true;
      reconnecting = false;
      emit('connected');
      return;
    }
    if (!everSynced) {
      // First successful sync straight from 'connecting' → steady state (hidden).
      everSynced = true;
      reconnecting = false;
      emit('connected');
    } else if (reconnecting) {
      // Recovered from an outage: show "Connected" (confirmed) briefly, then hide.
      reconnecting = false;
      emit('confirmed');
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        emit('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  });

  return {
    provider,
    destroy() {
      if (confirmTimer !== null) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.destroy();
    },
  };
}
