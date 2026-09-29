/**
 * The y-websocket wire framing shared by the BoardRoom and the tests.
 *
 * A client message is `[ varuint messageType, ...payload ]`. The BoardRoom decodes
 * the outer frame to route it (sync vs awareness), then hands the sync payload to
 * `y-protocols/sync` and relays awareness bytes verbatim. `decodeMessage` reports a
 * problem as `{ kind: 'invalid' }` rather than throwing, so the room can close just
 * the offending socket and keep every other editor connected.
 */
import * as decoding from 'lib0/decoding';

/** y-websocket message type: a `y-protocols/sync` message follows. */
export const MESSAGE_SYNC = 0;
/** y-websocket message type: an awareness update (verbatim length-prefixed bytes). */
export const MESSAGE_AWARENESS = 1;
/** y-websocket message type: a request for the current awareness states. */
export const MESSAGE_QUERY_AWARENESS = 3;

/** Close code sent to a socket that sent a frame this room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Close code sent to a client that opened a board whose saved state cannot be
 * loaded. The board is NOT presented as an empty editable board (persist.load_failure);
 * the client shows "This board couldn't be loaded. Retrying…" and keeps retrying.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * Close code sent to every socket when the room cannot durably save a change
 * (persist.save_failure). The board is still readable, so the client maps this to
 * `reconnecting` (not `load_failed`) and re-sends its unsaved change on reconnect.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** The result of decoding one client frame. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode one client frame. A text frame, a truncated/undecodable byte string, an
 * empty frame or an unknown message type all yield `{ kind: 'invalid', reason }`; a
 * well-formed frame yields a typed `sync` / `awareness` payload or `query-awareness`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  const decoder = decoding.createDecoder(bytes);
  try {
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Hand the whole remaining sync sub-message to y-protocols/sync.
        return { kind: 'sync', payload: decoding.readTailAsUint8Array(decoder) };
      }
      case MESSAGE_AWARENESS: {
        // The awareness update is a length-prefixed byte array; read it verbatim.
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}
