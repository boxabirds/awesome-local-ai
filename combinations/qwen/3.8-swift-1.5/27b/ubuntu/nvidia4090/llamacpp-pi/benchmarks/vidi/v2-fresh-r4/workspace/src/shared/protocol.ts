/**
 * y-websocket framing constants and message decode helper.
 * Shared by the Worker, the client provider, and tests.
 */
import { createDecoder, readUint8, readTailAsUint8Array } from 'lib0/decoding';

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
 * Decode a raw WebSocket frame (ArrayBuffer or string) into a typed message.
 * Returns { kind: 'invalid' } for any malformed input.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // String frames are not valid y-websocket messages
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  try {
    const uint8 = new Uint8Array(data);
    if (uint8.length < 1) {
      return { kind: 'invalid', reason: 'empty buffer' };
    }

    const decoder = createDecoder(uint8);
    const type = readUint8(decoder);

    switch (type) {
      case MESSAGE_SYNC: {
        const payload = readTailAsUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = readTailAsUint8Array(decoder);
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
