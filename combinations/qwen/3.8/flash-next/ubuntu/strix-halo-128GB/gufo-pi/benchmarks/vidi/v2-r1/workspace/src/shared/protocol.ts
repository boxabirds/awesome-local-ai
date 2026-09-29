/**
 * y-websocket message framing constants and decode helper, shared by
 * the Durable Object (server) and the tests.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a raw WebSocket message (binary y-websocket frame) into a typed result.
 * String frames, truncated data, and unknown message types all return invalid.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame not allowed' };
  }
  if (data.byteLength < 1) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  const bytes = new Uint8Array(data);
  const type = bytes[0];
  switch (type) {
    case MESSAGE_SYNC: {
      const payload = bytes.slice(1);
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'sync message has no payload' };
      }
      return { kind: 'sync', payload };
    }
    case MESSAGE_AWARENESS: {
      const payload = bytes.slice(1);
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'awareness message has no payload' };
      }
      return { kind: 'awareness', payload };
    }
    case MESSAGE_QUERY_AWARENESS: {
      return { kind: 'query-awareness' };
    }
    default:
      return { kind: 'invalid', reason: `unknown message type: ${type}` };
  }
}
