// y-websocket wire framing shared by the BoardRoom Durable Object and the tests.
//
// Every WebSocket message is:  [varint messageType][payload ...]
// where messageType is one of MESSAGE_SYNC / MESSAGE_AWARENESS /
// MESSAGE_QUERY_AWARENESS. The sync payload is itself a y-protocols sync
// sub-message (a varint sub-type followed by a varuint8array); it is passed to
// `syncProtocol.readSyncMessage` unchanged, so `decodeMessage` returns the raw
// remaining bytes for sync and only fully parses awareness/query frames.
//
// See design "BoardRoom Durable Object" contract.

import * as decoding from 'lib0/decoding';

/** Outer y-websocket message type: a y-protocols sync message. */
export const MESSAGE_SYNC = 0;
/** Outer y-websocket message type: an awareness update (relay-only in story 3). */
export const MESSAGE_AWARENESS = 1;
/** Outer y-websocket message type: an awareness query (ignored in story 3). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code sent for malformed / undecodable traffic. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Classify a single incoming WebSocket message.
 *
 * - A text (string) frame is always invalid (y-websocket traffic is binary).
 * - A truncated or undecodable varint, or an unknown message type, is invalid.
 * - `sync` returns the bytes following the message-type varint (the sync
 *   sub-message) so the room can hand them straight to `readSyncMessage`;
 *   deeper sync truncation is detected there, not here.
 * - `awareness` returns the decoded awareness update bytes.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes = toBytes(data);
  const decoder = decoding.createDecoder(bytes);

  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'truncated message type' };
  }

  try {
    switch (type) {
      case MESSAGE_SYNC: {
        if (decoder.pos >= decoder.arr.length) {
          return { kind: 'invalid', reason: 'empty sync message' };
        }
        return { kind: 'sync', payload: decoder.arr.subarray(decoder.pos) };
      }
      case MESSAGE_AWARENESS: {
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'truncated message body' };
  }
}
