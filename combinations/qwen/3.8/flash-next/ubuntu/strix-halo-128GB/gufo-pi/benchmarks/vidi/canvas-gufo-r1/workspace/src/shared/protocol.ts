/**
 * Shared protocol constants and decode helpers for y-websocket framing.
 * Message types match the y-websocket protocol:
 *   0 = sync, 1 = awareness, 3 = query-awareness
 */
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
 * Decode a raw WebSocket message (binary or text frame) into a typed result.
 * Text frames are always invalid (the protocol is binary-only).
 * Binary frames: first byte is the message type varint (always < 128 here so 1 byte).
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }
  const messageType = bytes[0]!;
  switch (messageType) {
    case MESSAGE_SYNC:
      if (bytes.length < 2) {
        return { kind: 'invalid', reason: 'truncated sync message' };
      }
      return { kind: 'sync', payload: bytes.slice(1) };
    case MESSAGE_AWARENESS:
      if (bytes.length < 2) {
        return { kind: 'invalid', reason: 'truncated awareness message' };
      }
      return { kind: 'awareness', payload: bytes.slice(1) };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${messageType}` };
  }
}
