/**
 * The client connection layer (`sync.connect`). A thin wrapper over y-websocket's
 * `WebsocketProvider` — it is never reimplemented — plus the status state machine that
 * keeps the indicator honest.
 *
 * The never-offline rule lives here: the layer starts optimistic (`connecting`), maps a
 * provider `connected` report to `online`, and treats every `disconnected` report as a
 * reconnect rather than offline. A mid-session drop therefore shows `Connecting…`, never
 * `Offline`. `offline` is reachable only by rendering the badge without a connection at
 * all (an invalid board id), which the App does directly.
 *
 * It also publishes a presence field into the provider's awareness so peers can count one
 * another, and reports the peer count — used only for a soft over-capacity note, never to
 * refuse a joiner (the capacity limit is advisory).
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.js';

/** The states the connection badge can show. */
export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** The badge label for a status. */
export const formatConnectionStatusLabel = (status: ConnectionStatus): string =>
  status === 'online' ? 'Connected' : status === 'offline' ? 'Offline' : 'Connecting…';

/** A live board connection that can be torn down. */
export interface BoardConnection {
  destroy(): void;
}

/** The `wss?://host/api/rooms` base the provider appends `/<boardId>` to. */
const roomBase = (): string => {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/rooms`;
};

/**
 * Connect `doc` to the room for `boardId`, report status through `onStatus` and the
 * number of *other* present editors through `onPeers`. Cross-tab
 * BroadcastChannel is disabled so the Durable Object room is always the transport.
 */
export const connectBoard = (options: {
  doc: Y.Doc;
  boardId: string;
  onStatus: (status: ConnectionStatus) => void;
  onPeers?: (peers: number) => void;
}): BoardConnection => {
  const { doc, boardId, onStatus, onPeers } = options;
  const provider = new WebsocketProvider(roomBase(), boardId, doc, {
    disableBc: true,
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
  });

  const reportPeers = (): void => {
    if (!onPeers) return;
    // The number of *other* editors: awareness carries every connected client's state
    // including our own, so we subtract one. Six people on a board read as "5" for the
    // sixth — exactly how many others are already there.
    onPeers(Math.max(0, provider.awareness.getStates().size - 1));
  };

  // `connected` => online (and publish presence); `connecting`/`disconnected` both map to
  // a reconnecting (never-offline) state, so a drop can never surface `Offline`.
  const onProviderStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }): void => {
    if (event.status === 'connected') {
      provider.awareness.setLocalStateField('editor', { since: Date.now() });
      onStatus('online');
    } else {
      onStatus('connecting');
    }
    reportPeers();
  };
  provider.on('status', onProviderStatus);
  provider.awareness.on('update', reportPeers);

  // Start optimistic: connecting, never offline, before the socket even opens.
  onStatus('connecting');
  reportPeers();

  return {
    destroy(): void {
      provider.awareness.off('update', reportPeers);
      provider.off('status', onProviderStatus);
      provider.disconnect();
      provider.destroy();
    },
  };
};
