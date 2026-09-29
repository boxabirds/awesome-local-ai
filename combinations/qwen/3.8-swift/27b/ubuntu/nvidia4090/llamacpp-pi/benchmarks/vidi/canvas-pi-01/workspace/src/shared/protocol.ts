// y-websocket message framing shared by the worker room, the test clients
// and the (browser) y-websocket provider (see spec: sync.room).
//
// Every binary frame is a varuint message type followed by a payload:
//   0 SYNC            -> the raw y-protocols/sync payload (its fields carry
//                        their own varuint lengths; no outer length prefix)
//   1 AWARENESS       -> a varuint8-prefixed awareness payload (relayed
//                        verbatim)
//   3 QUERY_AWARENESS -> no payload (ignored in this story)

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for string / undecodable / unknown-type / invalid-Yjs frames. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Close code for a board whose saved state cannot be loaded
 * (spec: persist.load_failure). Clients show "This board couldn't be
 * loaded. Retrying…" and the provider keeps retrying.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Close code for a room that cannot store an update (spec: persist.save_failure).
 * Clients treat it as a network loss: "Reconnecting…", and their open pages
 * re-send the unsaved changes through the sync handshake once back.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Decode one WebSocket frame into a typed result. Never throws. */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'string frame' };
  try {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readUint8(decoder);
    if (type === MESSAGE_SYNC) {
      const payload = decoding.readTailAsUint8Array(decoder);
      // A sync frame always carries at least the sync message type byte.
      if (payload.length === 0) return { kind: 'invalid', reason: 'empty sync payload' };
      return { kind: 'sync', payload };
    }
    if (type === MESSAGE_AWARENESS) {
      return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
    }
    if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };
    return { kind: 'invalid', reason: `unknown type ${type}` };
  } catch (err) {
    return { kind: 'invalid', reason: `decode failed: ${String(err)}` };
  }
}

/**
 * Re-frame a decoded payload for sending: sync payloads are written raw,
 * awareness payloads get their varuint8 length prefix back.
 */
export function encodeFrameMessage(type: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (type === MESSAGE_SYNC) {
    encoding.writeUint8Array(encoder, payload);
  } else {
    encoding.writeVarUint8Array(encoder, payload);
  }
  return encoding.toUint8Array(encoder);
}
