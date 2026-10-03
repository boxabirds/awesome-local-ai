// Wire framing shared by the BoardRoom Durable Object and the tests.
//
// The browser side speaks `y-websocket`'s framing, so the room must decode the
// same envelopes: one lib0 varuint message type, then a message-specific body.
//   0 = sync            body: a y-protocols/sync message (SyncStep1/2 or update)
//   1 = awareness       body: varuint length + an awareness update
//   3 = query-awareness body: none
// Anything else (text frames, truncated bodies, unknown types) is a protocol
// error and the room closes that single socket with CLOSE_UNSUPPORTED_DATA.

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code sent for non-binary / undecodable / unknown traffic. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Close code sent when a saved board cannot be loaded (persist.load_failure).
 * A client that sees it shows "This board couldn't be loaded. Retrying…" and
 * disables editing until a later attempt succeeds. It is deliberately distinct
 * from CLOSE_STORAGE_FAILURE, which is retryable without locking the board.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * Close code sent when the room cannot save a change (persist.save_failure). The
 * board itself is readable, so the client shows "Reconnecting…" and keeps editing
 * with its unsaved changes, which are re-sent through the sync handshake when the
 * socket comes back.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Read a lib0 varuint, refusing to read past the end of the buffer. */
function readVarUint(arr: Uint8Array, pos: { i: number }): number | null {
  let num = 0;
  let shift = 0;
  for (;;) {
    if (pos.i >= arr.length || shift > 63) return null; // truncated
    const byte = arr[pos.i++];
    num += shift < 28 ? (byte & 0x7f) << shift : (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return num;
    shift += 7;
  }
}

/**
 * Split one incoming WebSocket frame into its y-websocket message type and body.
 * Never throws: every failure mode is reported as `{ kind: 'invalid' }` so the
 * caller only has to close the offending socket.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    // y-websocket only ever sends binary frames; a text frame is a protocol bug.
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const arr = new Uint8Array(data);
  const pos = { i: 0 };
  const type = readVarUint(arr, pos);
  if (type === null) return { kind: 'invalid', reason: 'frame has no message type' };

  switch (type) {
    case MESSAGE_SYNC: {
      const payload = arr.subarray(pos.i);
      if (payload.length === 0) {
        return { kind: 'invalid', reason: 'sync frame has no body' };
      }
      return { kind: 'sync', payload: new Uint8Array(payload) };
    }
    case MESSAGE_AWARENESS: {
      const len = readVarUint(arr, pos);
      if (len === null) {
        return { kind: 'invalid', reason: 'awareness frame has no length' };
      }
      if (pos.i + len > arr.length) {
        return { kind: 'invalid', reason: 'awareness frame is truncated' };
      }
      return { kind: 'awareness', payload: new Uint8Array(arr.subarray(pos.i, pos.i + len)) };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}
