/**
 * The wire framing both the browser provider (`y-websocket`) and the BoardRoom
 * Durable Object speak, plus the one place where the bytes of an incoming
 * message are interpreted.
 *
 * A message is one binary WebSocket frame: a protobuf-style varUint message
 * type, then the message body. Nothing else is on the wire in this story.
 */
import { createDecoder, readVarUint } from 'lib0/decoding';

/** Frames carry a `y-protocols/sync` message (sync step 1/2 or an update). */
export const MESSAGE_SYNC = 0;
/** Frames carry a `y-protocols/awareness` update; relayed verbatim. */
export const MESSAGE_AWARENESS = 1;
/** A client asking for every known awareness state; ignored in this story. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code used for one misbehaving socket (RFC 6455 "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * persist.load_failure: the board behind this address could not be loaded, so
 * it is *not* empty. A code in the 4000-4999 range the client can act on; it is
 * outside y-websocket's 4400-4499 "reconnecting cannot help" sub-range on
 * purpose, because the provider must go on trying (the PRD's "keeps retrying").
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * persist.save_failure: the room could not write a change down, so it drops
 * every connection rather than let anyone see an unsaved change. Clients keep
 * what they had and re-send it when the room comes back.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** One interpreted WebSocket message, or why it could not be interpreted. */
export type Decoded =
  | { readonly kind: 'sync'; readonly payload: Uint8Array }
  | { readonly kind: 'awareness'; readonly payload: Uint8Array }
  | { readonly kind: 'query-awareness' }
  | { readonly kind: 'invalid'; readonly reason: string };

function invalid(reason: string): Decoded {
  return { kind: 'invalid', reason };
}

/**
 * Split one frame into its type and body. `payload` is a view of `data`, valid
 * while `data` is. Never throws: every problem (a text frame, an empty frame, a
 * truncated varUint, an unknown type, a sync/awareness frame without a body)
 * comes back as `{ kind: 'invalid', reason }` so the caller can close the
 * socket that sent it.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // Only binary frames are on the wire; a text frame is a client bug or an
  // attack, never something to interpret.
  if (typeof data === 'string') return invalid('text frames are not supported');
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) return invalid('empty message');
  let type: number;
  try {
    type = readVarUint(createDecoder(bytes));
  } catch {
    return invalid('truncated message type');
  }
  if (!Number.isInteger(type)) return invalid('unreadable message type');
  switch (type) {
    case MESSAGE_SYNC:
      // A sync frame always carries at least its sync step number.
      return bytes.byteLength < 2
        ? invalid('truncated sync frame')
        : { kind: 'sync', payload: bytes.subarray(1) };
    case MESSAGE_AWARENESS:
      return bytes.byteLength < 2
        ? invalid('truncated awareness frame')
        : { kind: 'awareness', payload: bytes.subarray(1) };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return invalid(`unknown message type ${type}`);
  }
}
