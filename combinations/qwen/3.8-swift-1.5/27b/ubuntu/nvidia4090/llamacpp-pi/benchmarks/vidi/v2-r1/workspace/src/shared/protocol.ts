import * as decoder from 'lib0/decoding';

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

  try {
    const uint8 = new Uint8Array(data);
    const dec = decoder.createDecoder(uint8);
    const type = decoder.readVarInt(dec);

    switch (type) {
      case MESSAGE_SYNC: {
        const payload = decoder.readVarUint8Array(dec);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoder.readVarUint8Array(dec);
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
