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

/** Splits a y-websocket frame into its type and payload; never throws. */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  try {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: decoding.readTailAsUint8Array(decoder) };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: decoding.readTailAsUint8Array(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'undecodable frame' };
  }
}
