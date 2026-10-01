// y-websocket framing constants
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

import * as decoding from 'lib0/decoding';

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  try {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) {
      return { kind: 'invalid', reason: 'empty frame' };
    }

    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarInt(decoder);
    const payload = bytes.slice(decoder.pos);

    if (type === MESSAGE_SYNC) {
      return { kind: 'sync', payload };
    } else if (type === MESSAGE_AWARENESS) {
      return { kind: 'awareness', payload };
    } else if (type === MESSAGE_QUERY_AWARENESS) {
      return { kind: 'query-awareness' };
    } else {
      return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch (e: any) {
    return { kind: 'invalid', reason: e?.message ?? 'decode error' };
  }
}
