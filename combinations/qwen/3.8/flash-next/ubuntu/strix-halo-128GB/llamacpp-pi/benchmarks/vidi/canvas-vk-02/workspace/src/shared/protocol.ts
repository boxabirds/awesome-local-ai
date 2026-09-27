/**
 * y-websocket wire framing, shared by the Durable Object and the tests
 * (design "sync.room").
 *
 * Every WebSocket message sent by the y-websocket client provider is
 *
 *   [varuint messageType, ...message body]
 *
 * where the body of a sync message is itself a `y-protocols/sync` message and
 * the body of an awareness message is a varuint-prefixed awareness update. The
 * room never interprets awareness; it relays those bytes verbatim.
 */

/** Body is a `y-protocols/sync` message (SyncStep1 / SyncStep2 / Update). */
export const MESSAGE_SYNC = 0;

/** Body is a varuint-prefixed awareness update. */
export const MESSAGE_AWARENESS = 1;

/** A request for everyone's awareness state; ignored in this story. */
export const MESSAGE_QUERY_AWARENESS = 3;

/** WebSocket close code for malformed traffic (RFC 6455 "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** `y-protocols/sync` inner message types, repeated here for validation. */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

/**
 * Result of classifying one frame:
 *
 * - `sync` / `awareness`: the payload is everything after the message-type
 *   varuint, ready to hand to `readSyncMessage` or to relay verbatim.
 * - `query-awareness`: no payload.
 * - `invalid`: the frame is a text frame, empty, truncated, or carries a
 *   message type this protocol does not know.
 */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Strict LEB128 reader that reports truncation instead of reading `undefined`
 * past the end (which is what lib0's decoder does, and is why this module does
 * its own bounds checking).
 */
function readVarUint(bytes: Uint8Array, position: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let next = position;
  for (;;) {
    if (next >= bytes.byteLength) return null;
    const byte = bytes[next] as number;
    next += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next };
    shift += 7;
    if (shift > 28) return null;
  }
}

/**
 * Read a varuint-prefixed byte array that must end exactly at the end of the
 * frame, returning the offset its bytes start at.
 */
function readExactLengthPrefixed(
  bytes: Uint8Array,
  position: number,
): { start: number } | null {
  const length = readVarUint(bytes, position);
  if (length === null) return null;
  if (length.next + length.value !== bytes.byteLength) return null;
  return { start: length.next };
}

/**
 * Classify one WebSocket frame. Anything the room cannot forward or apply is
 * reported as `{ kind: 'invalid' }` with a human-readable reason, so the caller
 * can close the offending socket and leave everybody else alone.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frames are not supported' };
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) return { kind: 'invalid', reason: 'empty frame' };

  const type = readVarUint(bytes, 0);
  if (type === null) return { kind: 'invalid', reason: 'truncated message type' };

  switch (type.value) {
    case MESSAGE_SYNC: {
      const inner = readVarUint(bytes, type.next);
      if (inner === null) return { kind: 'invalid', reason: 'truncated sync message type' };
      if (
        inner.value !== SYNC_STEP_1 &&
        inner.value !== SYNC_STEP_2 &&
        inner.value !== SYNC_UPDATE
      ) {
        return { kind: 'invalid', reason: `unknown sync message type ${inner.value}` };
      }
      if (readExactLengthPrefixed(bytes, inner.next) === null) {
        return { kind: 'invalid', reason: 'truncated sync message body' };
      }
      return { kind: 'sync', payload: bytes.subarray(type.next) };
    }
    case MESSAGE_AWARENESS: {
      if (readExactLengthPrefixed(bytes, type.next) === null) {
        return { kind: 'invalid', reason: 'truncated awareness update' };
      }
      return { kind: 'awareness', payload: bytes.subarray(type.next) };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type.value}` };
  }
}

/**
 * The awareness update inside a decoded awareness payload, or `null` when the
 * payload's length prefix does not describe the bytes after it.
 */
export function awarenessUpdateOf(payload: Uint8Array): Uint8Array | null {
  const length = readVarUint(payload, 0);
  if (length === null) return null;
  if (length.next + length.value !== payload.byteLength) return null;
  return payload.subarray(length.next);
}

/** One y-websocket message: message type varuint followed by `body`, verbatim.
 * Used where the body already carries whatever framing it needs, such as the
 * payload handed back by {@link decodeMessage}. */
export function frameMessage(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = type;
  out.set(body, 1);
  return out;
}

/**
 * An awareness message: the update inside its varuint length prefix, which is
 * how the y-websocket client sends and reads presence.
 */
export function awarenessMessage(update: Uint8Array): Uint8Array {
  const prefix: number[] = [];
  let remaining = update.byteLength;
  for (;;) {
    const byte = remaining & 0x7f;
    const more = remaining > byte;
    prefix.push(byte | (more ? 0x80 : 0));
    if (!more) break;
    remaining = Math.floor(remaining / 128);
  }
  const out = new Uint8Array(1 + prefix.length + update.byteLength);
  out[0] = MESSAGE_AWARENESS;
  out.set(prefix, 1);
  out.set(update, 1 + prefix.length);
  return out;
}
