// Client-side room connection. Story 5 adds nothing to the story-3 protocol:
// the room path is `/api/rooms/:id`, and reconnect/backoff stays delegated to
// y-websocket (`maxBackoffTime`) — no extra retry layer on top.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export function wsUrlFor(loc: Location): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/api/rooms`;
}

/** Full room URL for a board id (used by y-websocket as the server URL + room). */
export function roomUrl(boardId: string): string {
  return `${wsUrlFor(window.location)}/${encodeURIComponent(boardId)}`;
}

export function connectBoard(
  boardId: string,
  doc: Y.Doc,
): { provider: WebsocketProvider; awareness: WebsocketProvider['awareness'] } {
  const provider = new WebsocketProvider(wsUrlFor(window.location), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
  });
  return { provider, awareness: provider.awareness };
}
