/**
 * Story 3: y-websocket wire framing, shared by the room, the tests and any
 * client that speaks the protocol. Mirrors the constants in `y-websocket`.
 */
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code used for frames the room cannot interpret (story 3). */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * Story 4: close code for a board that cannot be loaded from storage (damaged
 * snapshot / SQL read error). The client maps this to `load_failed` and keeps
 * retrying; the room only retries its own load at most every
 * `LOAD_RETRY_MIN_INTERVAL_MS`.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/**
 * Story 4: close code for a storage write failure. The room discards its doc
 * and closes every socket; clients map this to `reconnecting` and re-send
 * unsaved changes on reconnect (persist.save_failure).
 */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes one y-websocket frame.
 *
 * - a text (string) frame is never valid;
 * - an unknown message type is invalid;
 * - a frame that cannot be fully decoded (truncated) is invalid.
 *
 * For `sync`, `payload` is the raw sync message (the bytes after the type).
 * For `awareness`, `payload` is the decoded awareness byte array.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = decoding.readTailAsUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'truncated frame' };
  }
}

/**
 * Encodes a y-websocket sync frame (type MESSAGE_SYNC + raw sync message).
 * The sync message is the raw tail (NOT length-prefixed). Exported so tests
 * build the same framing the browser provider uses.
 */
export function encodeSyncFrame(syncMessage: Uint8Array): Uint8Array {
  const header = encoding.encode((enc) => {
    encoding.writeVarUint(enc, MESSAGE_SYNC);
  });
  const out = new Uint8Array(header.byteLength + syncMessage.byteLength);
  out.set(header, 0);
  out.set(syncMessage, header.byteLength);
  return out;
}

/** Encodes a y-websocket awareness frame (type MESSAGE_AWARENESS + bytes). */
export function encodeAwarenessFrame(awarenessBytes: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessBytes);
  return encoding.toUint8Array(encoder);
}
