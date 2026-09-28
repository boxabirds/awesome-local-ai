// y-websocket wire framing shared by the Worker (BoardRoom) and the tests.
//
// Every WebSocket frame is binary: varUint(message type) + body. The body is
// framed differently per type, exactly as the y-websocket provider sends it:
//   - type 0 (sync): the body is the RAW inner y-protocols/sync message
//     (which itself starts with its own varUint type: SyncStep1/Step2/Update).
//   - type 1 (awareness): the body is varBytes(awareness update).
//   - type 3 ("query awareness"): no body; accepted and ignored (this story
//     stores no awareness state — story 6 interprets it).

import {
  createDecoder,
  readTailAsUint8Array,
  readVarUint,
  readVarUint8Array,
} from 'lib0/decoding';

/** Sync messages (y-protocols/sync framing, see readSyncMessage). */
export const MESSAGE_SYNC = 0;
/** Awareness updates (y-protocols/awareness framing). */
export const MESSAGE_AWARENESS = 1;
/** Request for the current awareness state; ignored in this story. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for a frame the room cannot interpret (string, truncated,
 *  unknown type, or an update Yjs rejects). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes one WebSocket message (arraybuffer) into a typed result. Never
 * throws: any malformed input (string frame, truncated bytes, unknown type,
 * empty payload) is reported as { kind: 'invalid', reason }.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  try {
    const decoder = createDecoder(new Uint8Array(data));
    const type = readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      // Raw inner sync message (no varBytes wrapper).
      const payload = readTailAsUint8Array(decoder);
      if (payload.length === 0) {
        return { kind: 'invalid', reason: 'empty payload' };
      }
      return { kind: 'sync', payload };
    }
    if (type === MESSAGE_AWARENESS) {
      // varBytes-framed awareness update.
      const payload = readVarUint8Array(decoder);
      if (payload.length === 0) {
        return { kind: 'invalid', reason: 'empty payload' };
      }
      return { kind: 'awareness', payload };
    }
    if (type === MESSAGE_QUERY_AWARENESS) {
      return { kind: 'query-awareness' };
    }
    return { kind: 'invalid', reason: `unknown message type ${type}` };
  } catch (err) {
    return { kind: 'invalid', reason: `truncated or malformed frame: ${String(err)}` };
  }
}
