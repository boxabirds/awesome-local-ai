import * as decoding from 'lib0/decoding';

/**
 * The wire format between a client and a board room: the y-websocket message framing,
 * which the Durable Object speaks and the tests build frames with.
 *
 * Every message is one binary WebSocket frame:
 *
 *   varUint(type) + payload
 *
 * `MESSAGE_SYNC` carries a `y-protocols/sync` message verbatim, `MESSAGE_AWARENESS`
 * carries a `y-protocols/awareness` update prefixed by its own varUint length, and
 * `MESSAGE_QUERY_AWARENESS` has no payload at all. Text frames and anything that does
 * not decode are answered with `CLOSE_UNSUPPORTED_DATA`.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** RFC 6455 "unsupported data"; the close code for a rejected update (story 3). */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Story 4: this board exists but could not be loaded (a damaged snapshot, an
 * unreadable database). The client must not present it as an empty board; it says
 * "This board couldn't be loaded. Retrying…" instead, and the provider keeps retrying.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Story 4: the room could not write to storage, so it dropped every socket while it
 * reloads. The board itself is fine; unsaved changes ride back in on reconnection.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/**
 * Where a board lives on the same origin, on both sides: `<scheme>://<host>` + this +
 * the board id. The Worker routes the prefix to that board's room, and the client
 * builds the address to dial.
 */
export const ROOM_PATH_PREFIX = '/api/rooms/';

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode one WebSocket frame. Never throws: a text frame, an unknown type, or bytes
 * that run out all become `{ kind: 'invalid', reason }` so the caller can close the
 * socket that sent them.
 *
 * lib0's own readers clamp a length that runs past the end of the buffer instead of
 * throwing, so the announced lengths are checked here — otherwise a truncated frame
 * would be handed to `y-protocols` as a short-but-valid-looking update.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'frame is a text frame, all board traffic is binary' };
  }
  let decoder: decoding.Decoder;
  let type: number;
  try {
    decoder = decoding.createDecoder(new Uint8Array(data));
    if (decoder.arr.length === 0) return { kind: 'invalid', reason: 'frame is empty' };
    type = decoding.readVarUint(decoder);
  } catch (error) {
    return { kind: 'invalid', reason: `frame has no message type (${reasonOf(error)})` };
  }

  switch (type) {
    case MESSAGE_SYNC:
      // A sync message is the rest of the frame; y-protocols reads it itself.
      return { kind: 'sync', payload: decoding.readTailAsUint8Array(decoder) };
    case MESSAGE_AWARENESS: {
      const payload = readLengthPrefixed(decoder);
      return payload === null
        ? { kind: 'invalid', reason: 'awareness update is truncated' }
        : { kind: 'awareness', payload };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}

/** Read a varUint length plus that many bytes, or null when the frame runs out. */
function readLengthPrefixed(decoder: decoding.Decoder): Uint8Array | null {
  let length: number;
  try {
    length = decoding.readVarUint(decoder);
  } catch {
    return null;
  }
  if (!Number.isInteger(length) || length < 0) return null;
  if (decoder.pos + length > decoder.arr.length) return null;
  return decoding.readUint8Array(decoder, length);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
