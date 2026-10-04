/**
 * y-websocket message framing, shared by the BoardRoom Durable Object and the
 * tests (which speak exactly the same bytes as the browser provider).
 *
 * A message is one binary WebSocket frame:
 *
 *   varUint type | payload
 *
 * `type` 0 carries a `y-protocols/sync` message, 1 an awareness update, 3 a
 * query-awareness request/response. Anything else is not part of the contract.
 */

import * as decoding from 'lib0/decoding';
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
} from 'y-protocols/sync';

/** First frame byte: a `y-protocols/sync` message follows. */
export const MESSAGE_SYNC = 0;

/** First frame byte: an awareness update follows. */
export const MESSAGE_AWARENESS = 1;

/** First frame byte: a query-awareness request or response. */
export const MESSAGE_QUERY_AWARENESS = 3;

/** WebSocket close code sent to a socket that breaks the framing contract. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * The sync message ranks this build understands, straight from `y-protocols`:
 * SyncStep1 ("send me what you are missing"), SyncStep2 ("here it is") and
 * Update ("apply this"). Every one of them is followed by a length-prefixed
 * byte array.
 */
const SYNC_RANKS: readonly number[] = [messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate];

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Check the structure of a `y-protocols/sync` message: one message rank
 * (SyncStep1, SyncStep2 or Update) followed by a length-prefixed byte array (a
 * state vector or a Yjs update).
 *
 * Returns `null` when the frame is structurally sound, otherwise a reason. The
 * bytes of a Yjs update are *not* validated here — `Y.applyUpdate` rejects
 * those, and the caller closes the socket either way.
 */
function checkSyncPayload(payload: Uint8Array): string | null {
  const decoder = decoding.createDecoder(payload);
  try {
    const rank = decoding.readVarUint(decoder);
    if (!SYNC_RANKS.includes(rank)) return `unknown sync message rank ${rank}`;
    decoding.readVarUint8Array(decoder);
    return null;
  } catch {
    return 'truncated sync message';
  }
}

/**
 * Classify one WebSocket frame.
 *
 * Text frames, empty frames, unknown types and structurally truncated binary
 * frames all come back as `{ kind: 'invalid' }` with a human-readable reason;
 * the caller decides what to do (the room closes that socket with
 * {@link CLOSE_UNSUPPORTED_DATA}). Semantic validity of a Yjs update is *not*
 * checked here — `Y.applyUpdate` does that.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported, expected binary' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) return { kind: 'invalid', reason: 'empty message' };

  const decoder = decoding.createDecoder(bytes);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'message has no type byte' };
  }

  switch (type) {
    case MESSAGE_SYNC: {
      const payload = bytes.subarray(decoder.pos);
      const problem = checkSyncPayload(payload);
      if (problem) return { kind: 'invalid', reason: problem };
      return { kind: 'sync', payload };
    }
    case MESSAGE_AWARENESS: {
      // The awareness update is a length-prefixed byte array, so the payload is
      // what follows the length — not the length itself.
      if (!decoding.hasContent(decoder)) {
        return { kind: 'invalid', reason: 'awareness message has no payload' };
      }
      try {
        const payload = decoding.readVarUint8Array(decoder);
        if (payload.byteLength === 0) {
          return { kind: 'invalid', reason: 'awareness message has no payload' };
        }
        return { kind: 'awareness', payload };
      } catch {
        return { kind: 'invalid', reason: 'truncated awareness message' };
      }
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}
