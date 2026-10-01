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

/** Classifies a y-websocket frame. `payload` is the whole frame (including the type byte) for sync/awareness. */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  try {
    const bytes = new Uint8Array(data);
    const type = decoding.readVarUint(decoding.createDecoder(bytes));
    if (type === MESSAGE_SYNC) return { kind: 'sync', payload: bytes };
    if (type === MESSAGE_AWARENESS) return { kind: 'awareness', payload: bytes };
    if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };
    return { kind: 'invalid', reason: `unknown message type ${type}` };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable' };
  }
}
