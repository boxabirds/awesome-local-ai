import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/**
 * The wire format both ends of a board connection speak: the y-websocket frame
 * `varUint(messageType) ++ payload`. Only the room ever needs to *decode* it;
 * tests use the same helpers so they exercise the identical framing (design
 * "Fixtures": integration clients use "the same framing as the browser
 * provider").
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

/** Close code used for any frame the room cannot understand (RFC 6455 §7.4). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Bytes still unread in a lib0 decoder (copied, never a view on a pooled buffer). */
function remaining(decoder: decoding.Decoder): Uint8Array {
  return decoder.arr.slice(decoder.pos);
}

/**
 * Split one incoming frame into its type and payload. Never throws: every
 * malformed input (text frame, empty buffer, truncated payload, unknown type)
 * comes back as `{ kind: 'invalid', reason }` so the caller can close just that
 * one socket.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  const decoder = decoding.createDecoder(new Uint8Array(data));
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'truncated message: no message type' };
  }
  switch (type) {
    case MESSAGE_SYNC: {
      const payload = remaining(decoder);
      if (payload.length === 0) {
        return { kind: 'invalid', reason: 'truncated sync message: no payload' };
      }
      return { kind: 'sync', payload };
    }
    case MESSAGE_AWARENESS: {
      try {
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      } catch {
        return {
          kind: 'invalid',
          reason: 'truncated awareness message: no payload',
        };
      }
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}

/**
 * Wrap a payload in its frame, e.g. `encodeFrame(MESSAGE_AWARENESS, bytes)`.
 * With no payload this is a bare type byte, which is what a query-awareness
 * frame looks like on the wire.
 */
export function encodeFrame(type: number, payload?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (payload) encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}
