/**
 * y-websocket message framing shared between server and tests.
 */
import * as encoding from 'lib0/encoding';

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
 * Read a varuint from a Uint8Array at the given position.
 * Returns [value, nextPosition] or null if the data is truncated.
 */
function readVarUint(buf: Uint8Array, pos: number): [number, number] | null {
  let num = 0;
  let shift = 0;
  let byte: number;
  do {
    if (pos >= buf.length) return null;
    byte = buf[pos++];
    num |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [num >>> 0, pos];
}

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame not allowed' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  try {
    const buf = new Uint8Array(data);
    const result = readVarUint(buf, 0);
    if (result === null) {
      return { kind: 'invalid', reason: 'truncated: cannot read type' };
    }
    const [type, pos] = result;
    switch (type) {
      case MESSAGE_SYNC: {
        const remaining = buf.slice(pos);
        return { kind: 'sync', payload: remaining };
      }
      case MESSAGE_AWARENESS: {
        const remaining = buf.slice(pos);
        return { kind: 'awareness', payload: remaining };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type: ${type}` };
    }
  } catch (e: unknown) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'decode error' };
  }
}

/** Helper to encode a sync message (used in tests) */
export function encodeSyncMessage(syncPayload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeUint8Array(enc, syncPayload);
  return encoding.toUint8Array(enc);
}

/** Helper to encode an awareness message (used in tests) */
export function encodeAwarenessMessage(awarenessPayload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeUint8Array(enc, awarenessPayload);
  return encoding.toUint8Array(enc);
}

/** Helper to encode a query-awareness message (used in tests) */
export function encodeQueryAwarenessMessage(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(enc);
}

/** Build a frame with an arbitrary type byte (for testing). */
export function buildUnknownFrame(typeByte: number, payload?: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, typeByte);
  if (payload) {
    encoding.writeUint8Array(enc, payload);
  }
  return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}
