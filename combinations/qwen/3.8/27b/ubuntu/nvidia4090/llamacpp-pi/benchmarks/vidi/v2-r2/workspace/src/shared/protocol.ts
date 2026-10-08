/**
 * y-websocket framing shared by the Worker room and the tests.
 *
 * A WebSocket frame is `[messageType : varUint, message definition...]`
 * (y-websocket WebsocketProvider, verified against y-websocket 3.1.0):
 *   - MESSAGE_SYNC          [0, sync message bytes...]
 *     where the sync message is a RAW y-protocols/sync message
 *     (SyncStep1 / SyncStep2 / Update) — NOT length-prefixed: the
 *     y-websocket sync handler hands the remaining frame bytes straight
 *     to y-protocols' readSyncMessage.
 *   - MESSAGE_AWARENESS     [1, varUint8Array(awareness update bytes)]
 *     — the awareness handler reads a length-prefixed byte array.
 *   - MESSAGE_QUERY_AWARENESS [3] — no payload.
 */

import * as decoding from 'lib0/decoding';

/** y-websocket message type: Yjs sync protocol message. */
export const MESSAGE_SYNC = 0;
/** y-websocket message type: awareness update bytes. */
export const MESSAGE_AWARENESS = 1;
/** y-websocket message type: query awareness (ignored in story 3). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for frames the room cannot make sense of. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Permanent-style close: the board failed to load. y-websocket treats close
 * codes 4400-4499 as permanent (no reconnect) and anything at/above 4500 as
 * transient (reconnect with backoff) — 4500 is therefore exactly the code a
 * LoadFailed room closes with: the client keeps retrying until the storage
 * is repaired (TC-24) without any page reload.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * Transient close: a storage write failed and the room reset itself
 * (PRD F5). Clients treat it like any other connection loss: reconnecting,
 * board stays editable; their pending updates re-sync on reconnect.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** A decoded WebSocket frame, or why it could not be decoded. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes one WebSocket frame. Never throws: any malformed input (string
 * frame, unknown type, truncated bytes) yields `{ kind: 'invalid' }`.
 */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  let bytes: Uint8Array;
  try {
    bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data as unknown as ArrayBuffer);
    if (bytes.byteLength === 0) {
      return { kind: 'invalid', reason: 'empty frame' };
    }
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Raw remainder of the frame: no length prefix (see header).
        const offset = decoder.pos;
        return {
          kind: 'sync',
          payload: bytes.subarray(offset, bytes.byteLength),
        };
      }
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return { kind: 'invalid', reason: `undecodable bytes (${String(error)})` };
  }
}
