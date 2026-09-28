/**
 * y-websocket message framing constants and decoder.
 * Shared between the Durable Object and tests.
 */
import * as decoding from 'lib0/decoding';

/** Message type constants matching y-websocket protocol. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a y-websocket framed message.
 * Returns typed results for known message types, or {kind:'invalid'} for errors.
 *
 * Framing:
 * - Sync: [varUint type=0][sync protocol bytes...]
 * - Awareness: [varUint type=1][varUint8Array(payload)]
 * - Query-awareness: [varUint type=3]
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame not allowed' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  try {
    const uint8 = new Uint8Array(data);
    const decoder = decoding.createDecoder(uint8);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Remaining bytes are sync protocol content (readSyncMessage will parse them)
        const remaining = uint8.length - decoder.pos;
        const payload = uint8.slice(decoder.pos, decoder.pos + remaining);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        // After the type byte, there is a varUint8Array containing the awareness update
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type: ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: `decode error: ${e}` };
  }
}
