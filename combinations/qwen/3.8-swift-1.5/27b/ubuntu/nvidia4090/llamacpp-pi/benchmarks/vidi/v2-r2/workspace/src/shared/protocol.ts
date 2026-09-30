import * as decoding from 'lib0/decoding';

// y-websocket framing message type constants
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_SYNC_AWARENESS = 2;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'unknown' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes a y-websocket framed message.
 *
 * Expected format: first byte is the message type, remaining bytes are the payload.
 * Returns a typed result, or { kind: 'invalid', reason } on any decode error.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // String frames are always invalid (must be binary)
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  const bytes = new Uint8Array(data);
  if (bytes.length < 1) {
    return { kind: 'invalid', reason: 'empty frame' };
  }

  const type = bytes[0];

  try {
    switch (type) {
      case MESSAGE_SYNC: {
        const decoder = decoding.createDecoder(bytes);
        decoding.readUint8(decoder); // skip type byte
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const decoder = decoding.createDecoder(bytes);
        decoding.readUint8(decoder); // skip type byte
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_SYNC_AWARENESS: {
        // Combined sync+awareness - treat as sync for now
        const decoder = decoding.createDecoder(bytes);
        decoding.readUint8(decoder); // skip type byte
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        // Unknown types are ignored (not fatal) for forward compatibility
        return { kind: 'unknown' };
    }
  } catch (e) {
    return { kind: 'invalid', reason: `decode error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
