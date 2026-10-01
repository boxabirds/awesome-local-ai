/**
 * Y-websocket message framing, shared between the BoardRoom Durable Object and tests.
 *
 * Wire format:
 * - Sync:      varuint(0) + sync-protocol-bytes (written directly, no outer length prefix)
 * - Awareness: varuint(1) + varuint8array(awareness-bytes) (varuint length-prefixed)
 * - QueryAwareness: varuint(3)
 */

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/** Message type constants (y-websocket protocol). */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a y-websocket framed message.
 * Returns `invalid` for string frames, truncated data, or unknown types.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame not allowed' };
  }
  if (data.byteLength < 1) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  try {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // For sync messages, the remaining bytes are the sync protocol payload (no outer length prefix).
        const remaining = bytes.slice(decoder.pos);
        return { kind: 'sync', payload: remaining };
      }
      case MESSAGE_AWARENESS: {
        // Awareness messages have a varuint8array payload (varuint-length-prefixed).
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type: ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: `decode error: ${String(e)}` };
  }
}

/**
 * Wrap raw sync protocol bytes with the MESSAGE_SYNC type varuint.
 * Since MESSAGE_SYNC = 0, its varuint encoding is a single 0x00 byte.
 */
export function wrapSyncMessage(syncPayload: Uint8Array): Uint8Array {
  const result = new Uint8Array(syncPayload.length + 1);
  result[0] = MESSAGE_SYNC;
  result.set(syncPayload, 1);
  return result;
}

/** Encode a y-websocket awareness message (varuint-length-prefixed payload). */
export function encodeAwarenessMessage(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** Encode a query-awareness message. */
export function encodeQueryAwarenessMessage(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}
