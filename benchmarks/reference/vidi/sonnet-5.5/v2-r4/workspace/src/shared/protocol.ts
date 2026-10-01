import * as decoding from 'lib0/decoding';

// y-websocket framing
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Splits a y-websocket frame into its type and the payload that follows the type byte. */
export function decodeMessage(data: ArrayBuffer | Uint8Array | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    const payload = bytes.subarray(decoder.pos);
    if (type === MESSAGE_SYNC) {
      if (payload.length === 0) return { kind: 'invalid', reason: 'empty sync message' };
      return { kind: 'sync', payload };
    }
    if (type === MESSAGE_AWARENESS) {
      if (payload.length === 0) return { kind: 'invalid', reason: 'empty awareness message' };
      return { kind: 'awareness', payload };
    }
    if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };
    return { kind: 'invalid', reason: `unknown message type ${type}` };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'decode error' };
  }
}
