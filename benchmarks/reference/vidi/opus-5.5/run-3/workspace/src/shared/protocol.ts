// y-websocket message framing, shared by the BoardRoom and the tests.
//   message = varUint(type) payload
//   sync:      payload is a y-protocols sync message (SyncStep1 / SyncStep2 / Update)
//   awareness: payload is varUint8Array(awareness update)
//   query-awareness: no payload
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot use (text, undecodable, unknown type, rejected update). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** `readVarUint8Array` with a bounds check (lib0 would return a view past the end of a sub-array). */
function readBytes(decoder: decoding.Decoder): Uint8Array {
  const len = decoding.readVarUint(decoder);
  if (decoder.pos + len > decoder.arr.length) throw new Error('truncated frame');
  return decoding.readUint8Array(decoder, len);
}

/**
 * Splits a frame into its message type and payload. `sync` payloads are the remaining bytes (a sync message
 * for `readSyncMessage`); `awareness` payloads are the awareness update inside the varUint8Array.
 * Never throws.
 */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes =
    data instanceof Uint8Array
      ? data
      : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty frame' };
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = bytes.subarray(decoder.pos);
        // A sync message is varUint(sync type) varUint8Array(data); check it is complete.
        const check = decoding.createDecoder(payload);
        decoding.readVarUint(check);
        readBytes(check);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: readBytes(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable frame' };
  }
}

/** Frames a sync message produced by `write` (e.g. `syncProtocol.writeSyncStep1`). */
export function encodeSync(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeQueryAwareness(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}
