import * as decoding from 'lib0/decoding';

/**
 * y-websocket message types (the first `varuint` of every frame). This is the
 * wire format the browser `WebsocketProvider` speaks, so the BoardRoom decodes
 * exactly these and nothing else.
 *
 * Framing, from `y-websocket/src/y-websocket.js`:
 * - `MESSAGE_SYNC` — followed *inline* by the y-protocols sync message
 *   (`varuint(subtype)` + its own payload). There is no extra length prefix.
 * - `MESSAGE_AWARENESS` — followed by a `varuint8array` payload.
 * - `MESSAGE_QUERY_AWARENESS` — alone.
 */

/** Sync step messages (SyncStep1 / SyncStep2 / Update, sub-typed inside). */
export const MESSAGE_SYNC = 0;
/** Awareness updates. */
export const MESSAGE_AWARENESS = 1;
/** Awareness query (ignored by the room in this story). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code sent for non-binary or undecodable traffic. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Close code for a board whose saved state could not be loaded (story 4,
 * PRD persist.load_failure). The client shows a red message and locks editing
 * instead of presenting a misleading empty board, and keeps retrying.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Close code sent when the room cannot write to storage (story 4, PRD
 * persist.save_failure). The board itself is readable and clients re-send what
 * the room lacks on reconnect, so this maps to "Reconnecting…", not to a
 * load failure. 1011 is the protocol's own "internal error" code.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/**
 * Whether a close code received from a peer may be echoed back with
 * `WebSocket.close()`. 1005 ("no status received") and 1006 ("connection ended
 * without a closing handshake") report what happened and are rejected as
 * arguments, so a status-less close is answered with a normal 1000.
 */
export function isEchoableCloseCode(code: number): boolean {
  return code === 1000 || (code >= 3000 && code <= 4999);
}

export type Decoded =
  /** `payload` starts at the y-protocols sync sub-type byte. */
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode one y-websocket frame. Returns `{ kind: 'invalid' }` (never throws)
 * for text frames, truncated buffers and unknown message types. Payloads are
 * validated for *frame* errors only; whether a Yjs update inside a sync
 * message applies is decided by `y-protocols`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  const decoder = decoding.createDecoder(new Uint8Array(data));
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'truncated message type' };
  }
  if (type === MESSAGE_QUERY_AWARENESS) {
    return { kind: 'query-awareness' };
  }
  if (type === MESSAGE_AWARENESS) {
    try {
      const payload = decoding.readVarUint8Array(decoder);
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'empty awareness payload' };
      }
      return { kind: 'awareness', payload };
    } catch {
      return { kind: 'invalid', reason: 'truncated awareness payload' };
    }
  }
  if (type !== MESSAGE_SYNC) {
    return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
  // Sync messages continue inline (y-protocols framing).
  if (decoder.pos >= data.byteLength) {
    return { kind: 'invalid', reason: 'truncated sync message' };
  }
  return {
    kind: 'sync',
    payload: new Uint8Array(data, decoder.pos),
  };
}
