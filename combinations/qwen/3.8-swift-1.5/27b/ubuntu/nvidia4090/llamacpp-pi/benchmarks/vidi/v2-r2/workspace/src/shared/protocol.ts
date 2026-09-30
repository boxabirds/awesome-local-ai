import * as decoding from 'lib0/decoding';

// y-websocket framing message type constants
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_SYNC_AWARENESS = 2;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_BOARD_LOAD_FAILED = 4500;   // saved board could not be loaded; room keeps retrying
export const CLOSE_STORAGE_FAILURE = 1011;     // the change could not be saved; clients retry on reconnect

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'unknown' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes a y-websocket framed message.
 *
 * Frame format (as implemented by the y-websocket client):
 *   [message_type: varuint][payload]
 * where the sync payload is the raw y-protocols sync message
 * ([sync_msg_type: varuint][data] — NOT length-prefixed) and the
 * awareness payload is a varuint8array.
 *
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

  try {
    const { value: type, next } = readVarUintAt(bytes, 0);

    switch (type) {
      case MESSAGE_SYNC: {
        // The sync payload is the remainder of the frame (starts with the
        // y-protocols sync message type).
        return { kind: 'sync', payload: bytes.subarray(next) };
      }
      case MESSAGE_AWARENESS: {
        const decoder = decoding.createDecoder(bytes.subarray(next));
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
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

/** Reads a varuint at `pos` without consuming a lib0 Decoder (which hides its cursor). */
function readVarUintAt(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = pos;
  for (;;) {
    if (i >= bytes.length) throw new Error('truncated varuint');
    const byte = bytes[i];
    i += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: i };
}
