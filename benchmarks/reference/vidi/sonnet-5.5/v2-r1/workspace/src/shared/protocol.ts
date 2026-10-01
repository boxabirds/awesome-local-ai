import * as decoding from 'lib0/decoding';

// y-websocket framing
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

/** Decodes the outer y-websocket frame. `payload` is the bytes after the message-type varint. */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  try {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    const payload = bytes.subarray(decoder.pos);
    switch (type) {
      case MESSAGE_SYNC:
        return payload.length > 0 ? { kind: 'sync', payload } : { kind: 'invalid', reason: 'empty sync message' };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable' };
  }
}
