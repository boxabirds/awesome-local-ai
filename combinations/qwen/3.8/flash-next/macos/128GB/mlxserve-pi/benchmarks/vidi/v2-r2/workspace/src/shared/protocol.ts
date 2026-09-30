// y-websocket message framing shared by the Durable Object, the client and the
// tests. A frame is `[varUint messageType, message body...]`. The type constants
// are the y-websocket message ids; sync bodies are y-protocols/sync messages and
// awareness bodies are y-protocols/awareness updates, relayed verbatim.

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code used for anything the room cannot decode or apply. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Sync sub-message ids (y-protocols/sync). Each wraps a varUint8Array body. */
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

/**
 * Read a lib0 varUint from `bytes` at `pos`. Returns null when the bytes run out
 * before the terminating (high-bit-clear) byte, which lib0's own reader would
 * silently read past — we want truncation to be detectable.
 */
function readVarUintChecked(bytes: Uint8Array, pos: number): { value: number; pos: number } | null {
  let value = 0;
  let shift = 0;
  let i = pos;
  for (;;) {
    if (i >= bytes.length) return null;
    const byte = bytes[i];
    i += 1;
    value += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, pos: i };
}

function asBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array
    ? data
    : new Uint8Array(data);
}

/**
 * Classify one received frame. Returns `invalid` for a text frame, an empty
 * frame, an unknown message type, or bytes truncated inside the header the type
 * depends on; otherwise a typed result carrying the full frame bytes so the
 * caller can relay them verbatim.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'expected a binary frame' };
  const bytes = asBytes(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty frame' };

  const type = readVarUintChecked(bytes, 0);
  if (type === null) return { kind: 'invalid', reason: 'truncated message type' };

  switch (type.value) {
    case MESSAGE_SYNC: {
      // [varUint messageType=0][varUint syncType][varUint8Array body]
      const syncType = readVarUintChecked(bytes, type.pos);
      if (syncType === null) return { kind: 'invalid', reason: 'truncated sync message type' };
      if (syncType.value !== SYNC_STEP1 && syncType.value !== SYNC_STEP2 && syncType.value !== SYNC_UPDATE) {
        return { kind: 'invalid', reason: `unknown sync message type ${syncType.value}` };
      }
      const len = readVarUintChecked(bytes, syncType.pos);
      if (len === null) return { kind: 'invalid', reason: 'truncated sync body length' };
      if (len.pos + len.value > bytes.length) {
        return { kind: 'invalid', reason: 'truncated sync body' };
      }
      return { kind: 'sync', payload: bytes };
    }
    case MESSAGE_AWARENESS:
      return { kind: 'awareness', payload: bytes };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type.value}` };
  }
}

/**
 * Close code for "this board's storage could not be loaded". The client shows
 * "This board couldn't be loaded. Retrying…" and keeps retrying; it must never
 * present the board as an empty editable one (persist.load_failure). It is in
 * y-websocket's retry-anyway range (4500-4599), so the provider keeps the board
 * retrying on its own backoff.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Close code for "the room could not save". The board itself is readable and the
 * change is still in every open page, so clients show "Reconnecting…" and their
 * unsaved changes are re-sent (and saved) when the connection is re-established
 * (persist.save_failure).
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/**
 * What a person is told when their board's storage could not be read. It is here,
 * beside the code that causes it, because the sentence and the code are the same
 * promise: the board is not gone, and it is being tried again. The wording is the
 * product's (persist.load_failure) and is said once, in the badge and over the
 * board itself.
 */
export const BOARD_LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";
