// Story 3: y-websocket frame protocol (anchor: sync.room).
//
// Framing is byte-identical to the y-websocket client (verified against its
// source): a varUint message type followed by a type-specific payload.
// The room uses decodeMessage to classify inbound frames before relaying or
// applying them; anything else closes the offending socket with
// CLOSE_UNSUPPORTED_DATA.

import { createDecoder, readVarUint } from 'lib0/decoding';

/** Yjs sync protocol (step1 / step2 / update). */
export const MESSAGE_SYNC = 0;
/** Awareness (presence) update, relayed verbatim. */
export const MESSAGE_AWARENESS = 1;
/** Permission auth (not used by this app; treated as unknown). */
export const MESSAGE_AUTH = 2;
/** Awareness query; ignored by the room in this story. */
export const MESSAGE_QUERY_AWARENESS = 3;

/**
 * Close code for a frame we cannot interpret: the string type, a truncated
 * frame, an unknown message type, or a Yjs update the document rejects.
 * 1003 is the standard "invalid frame payload data" code; the y-websocket
 * client treats it as transient and reconnects (full resync).
 */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Story 4: the room accepted the socket but the board's storage could not be
 * loaded (corrupt snapshot, failing SELECT). The client shows a load failure
 * and keeps retrying. The code sits outside the 4400–4499 "do not reconnect"
 * range, so the y-websocket provider auto-reconnects on its backoff.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * Story 4: an update was applied in memory but could not be stored (e.g. an
 * INSERT failure). The room drops its doc and closes all sockets with this
 * code; the next connection triggers a reload from storage (which restores
 * every durably stored change).
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** y-protocols sync sub-message types (inside a MESSAGE_SYNC frame). */
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Verify that the decoder is positioned at a complete varUint8Array that
 * consumes the rest of the buffer (a lib0 byte array: varUint length + the
 * bytes). Returns true when well-formed.
 */
function isTrailingVarUint8Array(dec: ReturnType<typeof createDecoder>): boolean {
  let length: number;
  try {
    length = readVarUint(dec);
  } catch {
    return false;
  }
  return dec.pos + length === dec.arr.length;
}

/**
 * Classify and validate one inbound WebSocket frame.
 *
 * `payload` is the frame's bytes after the message-type byte: for sync frames
 * the sync sub-message (sub-type + byte array), for awareness frames the
 * varUint8Array awareness update. The room relays/decodes only well-formed
 * frames; anything else is `invalid` and closes the sender's socket.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string-frame' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty-frame' };
  }
  const dec = createDecoder(new Uint8Array(data));
  let type: number;
  try {
    type = readVarUint(dec);
  } catch {
    return { kind: 'invalid', reason: 'truncated' };
  }
  const payloadStart = dec.pos;
  if (type === MESSAGE_SYNC) {
    let sub: number;
    try {
      sub = readVarUint(dec);
    } catch {
      return { kind: 'invalid', reason: 'truncated' };
    }
    if (sub !== SYNC_STEP1 && sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) {
      return { kind: 'invalid', reason: `unknown-sync-type-${sub}` };
    }
    if (!isTrailingVarUint8Array(dec)) {
      return { kind: 'invalid', reason: 'truncated' };
    }
    return { kind: 'sync', payload: dec.arr.slice(payloadStart) };
  }
  if (type === MESSAGE_AWARENESS) {
    if (!isTrailingVarUint8Array(dec)) {
      return { kind: 'invalid', reason: 'truncated' };
    }
    return { kind: 'awareness', payload: dec.arr.slice(payloadStart) };
  }
  if (type === MESSAGE_QUERY_AWARENESS) {
    return { kind: 'query-awareness' };
  }
  return { kind: 'invalid', reason: `unknown-type-${type}` };
}
