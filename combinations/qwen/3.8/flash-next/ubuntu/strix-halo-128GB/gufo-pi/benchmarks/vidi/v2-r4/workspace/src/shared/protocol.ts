/**
 * Shared Yjs wire protocol.
 * A frame is `varUint(type) + payload bytes`.
 */
import { createDecoder, readVarUint } from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type DecodedMessage =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness'; payload: Uint8Array }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a raw WebSocket message into a typed frame.
 * Text frames (non-binary) → invalid.
 * Empty buffers → invalid.
 * Unknown type → invalid.
 */
export function decodeMessage(data: unknown): DecodedMessage {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'unsupported text frame' };
  }
  // Handle ArrayBuffer, Uint8Array, Blob, etc.
  let bytes: Uint8Array;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return { kind: 'invalid', reason: 'unsupported text frame' };
  }

  if (bytes.length === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }

  const decoder = createDecoder(bytes);
  const type = readVarUint(decoder);
  const payload = bytes.slice(decoder.pos);

  if (type === MESSAGE_SYNC) {
    // A sync frame with no inner content is truncated (missing inner type byte)
    if (payload.length === 0) {
      return { kind: 'invalid', reason: 'truncated sync message' };
    }
    return { kind: 'sync', payload };
  }
  if (type === MESSAGE_AWARENESS) return { kind: 'awareness', payload };
  if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness', payload };
  return { kind: 'invalid', reason: 'unknown message type' };
}
