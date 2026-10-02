import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** Editing is disabled only while the board could not be loaded. */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface ConnectionHandle {
  destroy(): void;
}

/**
 * The subset of a y-websocket provider that connectBoard depends on. A fake
 * implementing this can be injected for tests (TC-28).
 */
export interface ProviderLike {
  on(event: string, cb: (arg?: any) => void): void;
  destroy(): void;
  wsconnected: boolean;
  synced: boolean;
}

export interface ConnectBoardOptions {
  /** Inject a provider (tests). Defaults to a real WebsocketProvider. */
  providerFactory?: (doc: Y.Doc, boardId: string, url: string) => ProviderLike;
}

/**
 * Creates a WebsocketProvider for the given Y.Doc and boardId, maps its
 * status/sync events to our ConnectionState machine, and calls onState on
 * every transition.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): ConnectionHandle {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${wsProtocol}//${window.location.host}/api/rooms`;

  const provider: ProviderLike = options.providerFactory
    ? options.providerFactory(doc, boardId, serverUrl)
    : new WebsocketProvider(serverUrl, boardId, doc, {
        maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
        disableBc: true,
      });

  // Expose provider for test access (window.__vidi6_disconnect/reconnect)
  if (typeof window !== 'undefined') {
    (window as any).__vidi6_disconnect = () => {
      const wsProvider = provider as any;
      wsProvider.shouldConnect = false;
      if (wsProvider.ws) {
        wsProvider.ws.onclose = null; // prevent reconnect handler
        wsProvider.ws.onmessage = null;
        try { wsProvider.ws.close(1006); } catch {}
        wsProvider.ws = null;
      }
      wsProvider.wsconnected = false;
      wsProvider.wsconnecting = false;
      // Manually trigger the state transitions
      wsProvider.emit('connection-close', [{ code: 1006 }, wsProvider]);
      wsProvider.emit('status', [{ status: 'disconnected' }, wsProvider]);
    };
    (window as any).__vidi6_reconnect = () => {
      const wsProvider = provider as any;
      wsProvider.shouldConnect = true;
      wsProvider.connect();
    };
  }

  let currentState: ConnectionState = 'connecting';
  let hasBeenSynced = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: ConnectionState) {
    if (next === currentState) return;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    currentState = next;
    onState(next);
  }

  // A board that fails to load is closed by the room with CLOSE_BOARD_LOAD_FAILED
  // (4500). We surface that as `load_failed` (read-only, red message). Every
  // other close code (including CLOSE_STORAGE_FAILURE 1011) is a transient drop
  // that the provider reconnects from: `reconnecting`, editing still enabled.
  provider.on('connection-close', (event: { code: number } | null) => {
    const code = event?.code ?? 0;
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      setState('load_failed');
    } else if (hasBeenSynced || currentState === 'connected' || currentState === 'confirmed') {
      setState('reconnecting');
    }
  });

  provider.on('status', (event: { status: string }) => {
    // While a board is known to have failed to load, stay in load_failed until a
    // sync succeeds (the provider keeps retrying in the background).
    if (currentState === 'load_failed') return;

    if (event.status === 'connecting') {
      if (hasBeenSynced) {
        // Reconnecting after a previous successful connection
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    } else if (event.status === 'connected') {
      // The socket is open but we may not be synced yet
      if (hasBeenSynced) {
        // Show "Connected" confirmation after reconnect
        setState('confirmed');
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
      // else: wait for sync event before marking connected
    } else if (event.status === 'disconnected') {
      if (hasBeenSynced) {
        setState('reconnecting');
      }
    }
  });

  provider.on('sync', (synced: boolean) => {
    if (synced) {
      hasBeenSynced = true;
      if (currentState === 'load_failed') {
        // A later successful sync recovers the board; editing re-enabled, no reload.
        setState('connected');
      } else if (currentState === 'connecting' || currentState === 'reconnecting') {
        // First sync → connected (no "connected" flash on first connect)
        setState('connected');
      } else if (currentState === 'confirmed') {
        // Already showing confirmation — let the timer handle transition
      }
    }
  });

  // Handle the case where we are already connected and synced at mount time
  // (provider might connect before we register listeners)
  setTimeout(() => {
    if (provider.wsconnected && provider.synced && !hasBeenSynced) {
      hasBeenSynced = true;
      setState('connected');
    }
  }, 0);

  return {
    destroy() {
      if (confirmTimer) clearTimeout(confirmTimer);
      provider.destroy();
    },
  };
}
