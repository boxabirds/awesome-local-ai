/**
 * The wire protocol of `/api/rooms/:boardId`, which is the `y-websocket` framing:
 * one `varUint` message type followed by its payload.
 *
 * Both the room and the tests decode with these helpers, so "what the room
 * considers malformed" has a single definition, and the test clients put exactly
 * the same bytes on the wire as the browser provider does.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/* ---------------------------------------------------------------- y-websocket message types */

/** `y-protocols/sync` message (SyncStep1, SyncStep2 or a single update). */
export const MESSAGE_SYNC = 0;
/** `y-protocols/awareness` update. */
export const MESSAGE_AWARENESS = 1;
/** Ask the server for the current awareness state (ignored in this story). */
export const MESSAGE_QUERY_AWARENESS = 3;

/** Close code sent to a socket that sent something undecodable. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Close code sent to a client when the board itself could not be loaded.
 *
 * It is in the 4500-4599 range, which `y-websocket` reads as "the server decided, and
 * trying again later is the right response": the provider keeps retrying, which is what
 * a board that may yet load needs. A 44xx code would stop the retries, and the board
 * would sit on "couldn't be loaded" forever.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** Close code sent to every socket when the room could not write a change down. */
export const CLOSE_STORAGE_FAILURE = 1011;

/* ---------------------------------------------------------------- y-protocols/sync sub-types */

/** "Here is my state vector; send me what I am missing." */
export const SYNC_STEP_1 = 0;
/** "Here is everything you are missing." */
export const SYNC_STEP_2 = 1;
/** One document update (what a client sends for every local edit). */
export const SYNC_UPDATE = 2;

/** Result of decoding one WebSocket frame. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** The sync sub-types `readSyncMessage` understands. */
const SYNC_SUB_TYPES: readonly number[] = [SYNC_STEP_1, SYNC_STEP_2, SYNC_UPDATE];

/**
 * Splits one frame into its message type and payload.
 *
 * `payload` is everything after the message-type `varUint`, so a `sync` payload
 * starts at the `y-protocols/sync` sub-type and can be handed straight to
 * `readSyncMessage`. Everything unreadable — a text frame, an empty frame, an
 * unknown type, a frame whose declared payload is longer than the frame itself —
 * comes back as `{ kind: 'invalid', reason }`; nothing throws.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frames are not supported' };
  if (data.byteLength === 0) return { kind: 'invalid', reason: 'empty message' };
  const bytes = new Uint8Array(data);
  const decoder = decoding.createDecoder(bytes);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'unreadable message type' };
  }

  if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };

  if (type === MESSAGE_AWARENESS) {
    if (decoder.pos >= bytes.length) return { kind: 'invalid', reason: 'empty awareness update' };
    return { kind: 'awareness', payload: bytes.subarray(decoder.pos) };
  }

  if (type !== MESSAGE_SYNC) return { kind: 'invalid', reason: `unknown message type ${type}` };

  // A sync frame is [sub-type, length-prefixed body]. Validate both so a
  // truncated frame is refused here instead of deep inside y-protocols.
  const syncContentStart = decoder.pos;
  let subType: number;
  let declared: number;
  try {
    subType = decoding.readVarUint(decoder);
    declared = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'truncated sync message' };
  }
  if (!SYNC_SUB_TYPES.includes(subType)) {
    return { kind: 'invalid', reason: `unknown sync message type ${subType}` };
  }
  if (decoder.pos + declared > bytes.length) {
    return { kind: 'invalid', reason: 'truncated sync message body' };
  }
  return { kind: 'sync', payload: bytes.subarray(syncContentStart) };
}

/** Joins byte arrays. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A `sync` frame around a `y-protocols/sync` message (the provider's framing). */
export function encodeSyncMessage(syncMessage: Uint8Array): Uint8Array {
  return concat([encodeVarUint(MESSAGE_SYNC), syncMessage]);
}

/** An `awareness` frame around awareness bytes (the provider's framing). */
export function encodeAwarenessMessage(update: Uint8Array): Uint8Array {
  return concat([encodeVarUint(MESSAGE_AWARENESS), update]);
}

/** The query-awareness frame: a type byte and nothing else. */
export function encodeQueryAwarenessMessage(): Uint8Array {
  return encodeVarUint(MESSAGE_QUERY_AWARENESS);
}

/** One `varUint` on its own (frames start with one). */
export function encodeVarUint(value: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, value);
  return encoding.toUint8Array(encoder);
}

/** A length-prefixed byte array, i.e. `lib0`'s `writeVarUint8Array`. */
export function encodeVarUint8Array(bytes: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
}

/** The message type of a frame, or -1 when the frame cannot be read. */
export function readMessageType(data: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(data));
  } catch {
    return -1;
  }
}

/** A whole `sync`/`update` frame: what the room forwards for every applied change. */
export function encodeUpdateFrame(update: Uint8Array): Uint8Array {
  return concat([
    encodeVarUint(MESSAGE_SYNC),
    encodeVarUint(SYNC_UPDATE),
    encodeVarUint8Array(update),
  ]);
}

/** The `y-protocols/sync` sub-type of a decoded sync payload, or -1. */
export function readSyncSubType(payload: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return -1;
  }
}
