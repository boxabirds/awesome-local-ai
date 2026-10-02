/**
 * The wire protocol of a board: the message framing spoken between the browser's
 * `WebsocketProvider` and the board's room.
 *
 * A message is one binary WebSocket frame: a message-type varuint, then the
 * bytes of a `y-protocols` sync or awareness message. The constants are shared
 * with the tests so a test can build exactly the bytes a client would send.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** `y-protocols/sync` message: document state vectors and updates. */
export const MESSAGE_SYNC = 0;
/** `y-protocols/awareness` message: presence state (interpreted from story 6). */
export const MESSAGE_AWARENESS = 1;
/** A client asking the room which participants it knows about. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code sent to a socket that sent data this room cannot use (RFC 6455). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** One decoded frame, or the reason the frame cannot be used. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** A frame carrying a sync message: the type byte followed by `payload`. */
export function encodeSyncMessage(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** A frame carrying awareness bytes. */
export function encodeAwarenessMessage(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** A frame asking the room about its participants. */
export function encodeQueryAwarenessMessage(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

/**
 * Reads the framing of one incoming frame.
 *
 * Anything the room cannot act on comes back as `{ kind: 'invalid' }` with a
 * human-readable reason: a text frame, an empty frame, a truncated frame or a
 * message type this protocol does not have.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'a board message must be binary, not text' };
  }
  const decoder = decoding.createDecoder(new Uint8Array(data));
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'a board message must start with its type' };
  }
  if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };
  if (type !== MESSAGE_SYNC && type !== MESSAGE_AWARENESS) {
    return { kind: 'invalid', reason: `unknown board message type ${type}` };
  }
  if (decoder.pos >= decoder.arr.length) {
    return { kind: 'invalid', reason: 'the board message stops before its body' };
  }
  const payload = decoding.readTailAsUint8Array(decoder);
  return type === MESSAGE_SYNC ? { kind: 'sync', payload } : { kind: 'awareness', payload };
}
