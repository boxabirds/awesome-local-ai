// y-websocket framing protocol (story 3).
// Message types match y-websocket's wire format.

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
/** The board's saved state could not be loaded (story 4): retry later. */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** The room could not durably save an update (story 4). */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a single WebSocket frame from the y-websocket protocol.
 * Accepts an ArrayBuffer (binary frame) or a string (text frame).
 * Returns a typed result or an invalid marker.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  try {
    const bytes = new Uint8Array(data);
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);

    switch (type) {
      case MESSAGE_SYNC: {
        // Remaining bytes are the sync payload
        const payload = bytes.slice(dec.pos);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        // Remaining bytes are the awareness payload
        const payload = bytes.slice(dec.pos);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: `decode error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
