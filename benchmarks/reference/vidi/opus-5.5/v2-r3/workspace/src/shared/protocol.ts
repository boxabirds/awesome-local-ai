// y-websocket message framing shared by the BoardRoom and tests.
//
// Every binary frame starts with a varUint message type:
//   MESSAGE_SYNC            varUint subtype + varUint8Array payload (y-protocols/sync)
//   MESSAGE_AWARENESS       varUint8Array awareness update
//   MESSAGE_QUERY_AWARENESS no payload
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

// y-protocols/sync subtypes.
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** readVarUint8Array that rejects a length running past the end of the frame. */
function readBoundedBytes(decoder: decoding.Decoder): Uint8Array {
  const len = decoding.readVarUint(decoder);
  if (decoder.pos + len > decoder.arr.length) throw new Error('truncated frame');
  return decoding.readUint8Array(decoder, len);
}

/**
 * Validates a frame's structure. For sync frames `payload` is the frame body
 * after the message type (subtype + data), ready for `readSyncMessage`; for
 * awareness frames it is the awareness update itself.
 */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes =
    data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const start = decoder.pos;
        const subtype = decoding.readVarUint(decoder);
        if (subtype !== SYNC_STEP_1 && subtype !== SYNC_STEP_2 && subtype !== SYNC_UPDATE) {
          return { kind: 'invalid', reason: `unknown sync subtype ${subtype}` };
        }
        readBoundedBytes(decoder);
        if (decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'trailing bytes' };
        return { kind: 'sync', payload: bytes.subarray(start) };
      }
      case MESSAGE_AWARENESS: {
        const payload = readBoundedBytes(decoder);
        if (decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'trailing bytes' };
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable' };
  }
}

/** Frames a sync message body (subtype + data) as a MESSAGE_SYNC frame. */
export function encodeSyncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** Frames an awareness update as a MESSAGE_AWARENESS frame. */
export function encodeAwarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}
