/**
 * The wire format between the browser provider (y-websocket) and the BoardRoom
 * Durable Object: every message is a binary WebSocket frame whose first field
 * is a varuint message type. The room shares these constants and this decoder
 * with its tests so the framing under test is the framing in production.
 */
import * as decoding from 'lib0/decoding';

/** y-websocket: the frame carries a y-protocols/sync message. */
export const MESSAGE_SYNC = 0;

/** y-websocket: the frame carries an awareness update, opaque to this room. */
export const MESSAGE_AWARENESS = 1;

/** y-websocket: "send me every awareness state" (ignored in story 3). */
export const MESSAGE_QUERY_AWARENESS = 3;

/** RFC 6455 "unsupported data": what the room closes a socket with. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * The board this room serves could not be loaded, and will not be presented as
 * an empty one (PRD persist.load_failure). 4500 is the first code of y-websocket
 * provider's "try again later" range, so the provider keeps retrying it.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * The room could not save a change, so it dropped every connection rather than
 * show an unsaved change as saved (PRD persist.save_failure). 1011 is the
 * generic "server had a problem" code: the client reconnects and re-sends what
 * the room is missing.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** y-protocols/sync message kinds inside a MESSAGE_SYNC frame. */
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const UPDATE = 2;

/**
 * A decoded frame. `payload` is the *complete* frame, type prefix included, so
 * it can be relayed to other sockets verbatim; before handing a sync frame to
 * `syncProtocol.readSyncMessage`, skip the message type prefix (as the room
 * does) so the decoder sits on the sync message itself. Only the framing (type
 * + length prefixes) is validated here; the body of a sync frame is validated by
 * the room, which is where Yjs itself can reject an update.
 */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Read the y-websocket frame prefix of `data` and classify it. Anything that
 * cannot be read — a text frame, a truncated frame, an unknown message type —
 * comes back as `{ kind: 'invalid' }` with the reason; the caller closes that
 * one socket with CLOSE_UNSUPPORTED_DATA.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  const decoder = decoding.createDecoder(bytes);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'frame is empty or its message type is truncated' };
  }
  switch (type) {
    case MESSAGE_SYNC: {
      // y-protocols/sync: varuint message kind, then a length-prefixed payload
      // (a state vector or a document update).
      let kind: number;
      try {
        kind = decoding.readVarUint(decoder);
      } catch {
        return { kind: 'invalid', reason: 'truncated sync frame' };
      }
      if (kind !== SYNC_STEP1 && kind !== SYNC_STEP2 && kind !== UPDATE) {
        return { kind: 'invalid', reason: `unknown sync message type ${kind}` };
      }
      const body = readLengthPrefixed(decoder);
      if (body === null) return { kind: 'invalid', reason: 'truncated sync frame' };
      return { kind: 'sync', payload: bytes };
    }
    case MESSAGE_AWARENESS: {
      // y-protocols/awareness: one length-prefixed update, never interpreted here.
      const body = readLengthPrefixed(decoder);
      if (body === null) return { kind: 'invalid', reason: 'truncated awareness frame' };
      return { kind: 'awareness', payload: bytes };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}

/**
 * lib0's readVarUint8Array stops silently at the end of the buffer, so a frame
 * that promises more bytes than it carries has to be caught by hand: the length
 * must fit in what is left.
 */
const readLengthPrefixed = (decoder: decoding.Decoder): Uint8Array | null => {
  let length: number;
  try {
    length = decoding.readVarUint(decoder);
  } catch {
    return null;
  }
  if (decoder.arr.length - decoder.pos < length) return null;
  return decoding.readUint8Array(decoder, length);
};
