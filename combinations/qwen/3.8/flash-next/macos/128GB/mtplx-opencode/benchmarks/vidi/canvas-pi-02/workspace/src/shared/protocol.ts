/**
 * The y-websocket wire framing, shared by the room and the tests.
 *
 * Every WebSocket message of this protocol is a binary frame:
 *
 * ```text
 * [message type : varUint][body...]
 * ```
 *
 * with body `[sync sub-type : varUint][length : varUint][bytes]` for the two
 * sync kinds and `[length : varUint][bytes]` for awareness. The type numbers
 * are the ones `y-websocket` uses; they are re-declared here instead of
 * imported from `y-websocket` because that module drags in browser-only code
 * (`broadcastchannel`, `WebSocket`) that must not end up in the Worker bundle.
 *
 * `decodeMessage` is the room's only gate: it says *what a frame is* and
 * nothing else. A frame whose declared lengths do not add up is reported as
 * invalid rather than handed to Yjs, so a truncated message cannot make the
 * room read past the end of the buffer.
 */

/** Sync messages; the body carries a sync sub-type (see `y-protocols/sync`). */
export const MESSAGE_SYNC = 0;

/** Awareness updates (presence data, relayed but not interpreted in 3). */
export const MESSAGE_AWARENESS = 1;

/** Permission requests. There is no auth in this story; anything sent is refused. */
export const MESSAGE_AUTH = 2;

/** "Who is here?" - answered by nobody until presence arrives in story 6. */
export const MESSAGE_QUERY_AWARENESS = 3;

/** Close code sent back for any frame the room cannot use. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** `y-protocols/sync`: "this is my state vector, send me what I lack". */
export const SYNC_STEP_ONE = 0;

/** `y-protocols/sync`: "here is what you were missing". */
export const SYNC_STEP_TWO = 1;

/** `y-protocols/sync`: a standalone document update. */
export const SYNC_UPDATE = 2;

/**
 * What a frame turned out to be.
 *
 * `payload` is the frame *after* the message-type byte, still length-prefixed
 * where the protocol says so - exactly what `readSyncMessage` expects, and
 * what an awareness relay hands straight back to the other sockets.
 */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Anything a WebSocket `message` event can carry, plus what the tests build. */
export type MessageData = ArrayBuffer | ArrayBufferView | string;

function invalid(reason: string): Decoded {
  return { kind: 'invalid', reason };
}

/** Copy a frame into one contiguous `Uint8Array` starting at its first byte. */
function toBytes(data: MessageData): Uint8Array | null {
  if (typeof data === 'string') return null;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

/**
 * Read a varUint (the LEB128-ish encoding lib0 and Yjs use).
 *
 * Returns `null` when the number runs off the end of the buffer or is longer
 * than five bytes, which is the shape of every "truncated message" test in
 * this story. `position` is advanced only on success.
 */
function readVarUint(bytes: Uint8Array, position: { index: number }): number | null {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (position.index >= bytes.length) return null;
    const byte = bytes[position.index]!;
    position.index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Length-prefixed byte body, validated to end exactly at the frame's end. */
function readLengthPrefixed(bytes: Uint8Array, position: { index: number }): Uint8Array | null {
  const length = readVarUint(bytes, position);
  if (length === null) return null;
  if (position.index + length !== bytes.length) return null;
  return bytes.subarray(position.index, bytes.length);
}

function decodeSyncFrame(bytes: Uint8Array, position: { index: number }): Decoded {
  const bodyStart = position.index;
  const subType = readVarUint(bytes, position);
  if (subType === null) return invalid('sync frame has no sync message type');
  if (subType !== SYNC_STEP_ONE && subType !== SYNC_STEP_TWO && subType !== SYNC_UPDATE) {
    return invalid(`unknown sync message type ${subType}`);
  }
  if (subType === SYNC_STEP_ONE) {
    // SyncStep1 is a bare state vector; it may legitimately be empty (a fresh
    // document), so only the length prefix is checked.
    const stateVector = readLengthPrefixed(bytes, position);
    if (stateVector === null) return invalid('truncated sync step 1');
  } else {
    const update = readLengthPrefixed(bytes, position);
    if (update === null) return invalid('truncated sync payload');
  }
  return { kind: 'sync', payload: bytes.subarray(bodyStart, bytes.length) };
}

/**
 * Classify one incoming frame.
 *
 * Never throws: every failure comes back as `{ kind: 'invalid', reason }`, so
 * the caller's only job is to close the socket with
 * {@link CLOSE_UNSUPPORTED_DATA} and move on to the next client.
 */
export function decodeMessage(data: MessageData): Decoded {
  if (typeof data === 'string') {
    // The protocol is binary. A text frame is either a foreign client or a
    // mistake; either way it is not something to guess at.
    return invalid('text frames are not supported');
  }
  const bytes = toBytes(data);
  if (bytes === null) return invalid('unsupported frame type');
  if (bytes.byteLength === 0) return invalid('empty frame');

  const position = { index: 0 };
  const type = readVarUint(bytes, position);
  if (type === null) return invalid('truncated message type');

  switch (type) {
    case MESSAGE_SYNC:
      return decodeSyncFrame(bytes, position);
    case MESSAGE_AWARENESS: {
      const body = readLengthPrefixed(bytes, position);
      // An empty awareness update carries no client state at all, so there is
      // nothing for the room to relay and nothing to keep a socket alive.
      if (body === null || body.byteLength === 0) return invalid('empty awareness update');
      return { kind: 'awareness', payload: body };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    case MESSAGE_AUTH:
      return invalid('authentication is not supported');
    default:
      return invalid(`unknown message type ${type}`);
  }
}
