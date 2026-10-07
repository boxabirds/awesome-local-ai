/**
 * Y-WebSocket message framing helpers.
 * Story 3 — live collaboration.
 */

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

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
 * Encode a y-websocket message frame: [type uint8][payload bytes].
 */
export function encodeMessage(type: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(1 + payload.length);
  result[0] = type;
  result.set(payload, 1);
  return result;
}

/**
 * Decode a y-websocket message from an ArrayBuffer or string.
 * Y-WebSocket framing: [type uint8][payload bytes].
 * Returns typed result for known types, invalid for unknown/truncated/strings.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame not supported' };
  }

  try {
    const arr = new Uint8Array(data);
    if (arr.length < 1) {
      return { kind: 'invalid', reason: 'truncated bytes' };
    }
    const type = arr[0];
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: arr.slice(1) };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: arr.slice(1) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'decode error' };
  }
}
