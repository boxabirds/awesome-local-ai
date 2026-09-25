/**
 * y-websocket message framing shared by the BoardRoom and tests (anchor: sync.room).
 * A frame is `varUint(messageType)` followed by the type's payload.
 */
import * as decoding from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot understand or apply. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/** WebSocket close code: the board's saved state cannot be loaded (client shows load_failed). */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** WebSocket close code: a change could not be saved; the room resets and clients reconnect. */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Splits a frame into its type and payload. `sync` payload is the remaining bytes (a
 * y-protocols sync message, still to be read with `readSyncMessage`); `awareness` payload
 * is the length-prefixed awareness update. Never throws.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty frame' };
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = bytes.subarray(decoder.pos);
        // A sync message is varUint(syncType) + varUint8Array; check it is complete.
        const check = decoding.createDecoder(payload);
        decoding.readVarUint(check);
        decoding.readVarUint8Array(check);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'truncated frame' };
  }
}
