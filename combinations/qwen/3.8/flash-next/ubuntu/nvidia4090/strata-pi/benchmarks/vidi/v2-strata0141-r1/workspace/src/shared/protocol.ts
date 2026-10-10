import * as decoding from 'lib0/decoding';

/**
 * The wire protocol of the live board (anchor `sync.room`).
 *
 * Frames use the y-websocket framing so the room and the browser provider
 * speak the same bytes:
 *
 * ```text
 * frame = varUint(type) payload
 *   type 0  sync            y-protocols/sync message (SyncStep1 / SyncStep2 / Update)
 *   type 1  awareness       y-protocols/awareness update
 *   type 3  query-awareness "who is here?" (answered by the server, ignored here)
 * ```
 *
 * The room never interprets the payload: it decodes the type, applies or
 * relays, and closes (code 1003) anything that is not one of these.
 */

/** y-websocket message type for Yjs sync/updates. */
export const MESSAGE_SYNC = 0;
/** y-websocket message type for awareness updates. */
export const MESSAGE_AWARENESS = 1;
/** y-websocket message type for awareness queries. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code sent to a socket that sent something undecodable (RFC 6455 1003). */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Close code sent to every socket of a board whose saved state could not be
 * loaded (story 4). It sits in the 4500-4599 range, the y-websocket convention
 * for "the server refused, but trying again can help", so the provider keeps
 * retrying while the client shows "This board couldn't be loaded. Retrying…".
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Close code sent to every socket when the room could not write to its own
 * storage (story 4): the change was not saved and was not broadcast, so each
 * client keeps its own copy and re-sends it when the room is back.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** y-protocols/sync sub-message types (the first varUint after MESSAGE_SYNC). */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

export type Decoded =
  /** The sync sub-message, i.e. everything after the type byte. */
  | { kind: 'sync'; payload: Uint8Array }
  /** An awareness update, i.e. everything after the type byte. */
  | { kind: 'awareness'; payload: Uint8Array }
  /** An awareness query; this story keeps no awareness state, so nothing to answer. */
  | { kind: 'query-awareness' }
  /** Anything else: the sender gets closed with CLOSE_UNSUPPORTED_DATA. */
  | { kind: 'invalid'; reason: string };

const invalid = (reason: string): Decoded => ({ kind: 'invalid', reason });

const asBytes = (data: ArrayBuffer | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

/**
 * Is `payload` a complete y-protocols sync message?
 * `null` when it is, otherwise the reason it is not.
 */
export function syncPayloadError(payload: Uint8Array): string | null {
  const decoder = decoding.createDecoder(payload);
  try {
    const subtype = decoding.readVarUint(decoder);
    if (subtype !== SYNC_STEP_1 && subtype !== SYNC_STEP_2 && subtype !== SYNC_UPDATE) {
      return `unknown sync message type ${subtype}`;
    }
    // Both remaining sub-messages are one length-prefixed byte string.
    decoding.readVarUint8Array(decoder);
    if (decoder.pos !== payload.length) {
      return 'trailing bytes after sync message';
    }
    return null;
  } catch {
    return 'truncated sync message';
  }
}

/** Decode one WebSocket frame into a typed message, or an `invalid` reason. */
export function decodeMessage(data: ArrayBuffer | string | Uint8Array): Decoded {
  // The protocol is binary only: a text frame is a client bug or an attack.
  if (typeof data === 'string') {
    return invalid('text frames are not supported');
  }
  const bytes = asBytes(data);
  if (bytes.byteLength === 0) {
    return invalid('empty message');
  }
  const decoder = decoding.createDecoder(bytes);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return invalid('truncated message type');
  }
  switch (type) {
    case MESSAGE_SYNC: {
      if (decoder.pos >= bytes.byteLength) {
        return invalid('truncated sync message');
      }
      const payload = bytes.subarray(decoder.pos);
      const error = syncPayloadError(payload);
      return error === null ? { kind: 'sync', payload } : invalid(error);
    }
    case MESSAGE_AWARENESS: {
      if (decoder.pos >= bytes.byteLength) {
        return invalid('truncated awareness message');
      }
      return { kind: 'awareness', payload: bytes.subarray(decoder.pos) };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return invalid(`unknown message type ${type}`);
  }
}
