export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
// A saved board could not be loaded. Application range (4000-4999) so the client
// provider keeps retrying (y-websocket only stops retrying for 4400-4499).
export const CLOSE_BOARD_LOAD_FAILED = 4500;
// The room hit a storage write failure; sockets are closed and the doc discarded.
// The board is still readable on the next connection, so this is transient.
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

import * as decoding from 'lib0/decoding';

/**
 * Decode a y-websocket message frame.
 *
 * Wire format (matching y-websocket provider and server):
 * - Sync (type 0): [varUint(0)] [sync_content] (sync_content starts with varUint(syncType))
 * - Awareness (type 1): [varUint(1)] [varUint8Array(awareness_data)]
 * - Query awareness (type 3): [varUint(3)]
 *
 * For sync, `payload` is the raw remaining bytes (the sync protocol message).
 * For awareness, `payload` is the decoded varUint8Array contents.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame not allowed' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Remaining bytes are the sync protocol message (starts with varUint(syncType))
        const remaining = bytes.slice(decoder.pos);
        return { kind: 'sync', payload: remaining };
      }
      case MESSAGE_AWARENESS: {
        // Awareness wraps its content in a varUint8Array
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e: unknown) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'decode error' };
  }
}
