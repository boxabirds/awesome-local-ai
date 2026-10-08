/** Protocol helpers for story 3 — y-websocket framing */

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Message type constants (y-websocket protocol)
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

// Story 4 — Board persistence close codes
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

/** Decoded message from a WebSocket frame. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a WebSocket message into known y-websocket types.
 * Returns `invalid` on any decode error (unknown type, truncated bytes).
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  try {
    if (typeof data === 'string') {
      return { kind: 'invalid', reason: 'string frame not supported' };
    }

    const arrBuf = data as ArrayBuffer;
    if (arrBuf.byteLength < 1) {
      return { kind: 'invalid', reason: 'empty frame' };
    }

    const buf = new Uint8Array(arrBuf);
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(buf);

    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const syncData = decoding.readVarUint8Array(decoder);
        return { kind: 'sync', payload: syncData };
      }
      case MESSAGE_AWARENESS: {
        const awarenessData = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload: awarenessData };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type ${messageType}` };
    }
  } catch (_err) {
    return { kind: 'invalid', reason: 'decode error' };
  }
}
