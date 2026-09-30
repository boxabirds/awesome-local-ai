import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

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

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.length < 1) {
    return { kind: 'invalid', reason: 'truncated bytes' };
  }
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarInt(decoder);
    if (type === MESSAGE_SYNC) {
      const payload = decoding.readVarUint8Array(decoder);
      return { kind: 'sync', payload };
    } else if (type === MESSAGE_AWARENESS) {
      const payload = decoding.readVarUint8Array(decoder);
      return { kind: 'awareness', payload };
    } else if (type === MESSAGE_QUERY_AWARENESS) {
      return { kind: 'query-awareness' };
    } else {
      return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'decode error' };
  }
}

export function encodeSyncMessage(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_SYNC);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessMessage(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}
