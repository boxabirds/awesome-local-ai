/**
 * y-websocket message framing constants and decode helpers shared by the
 * Worker, the client provider, and tests.
 */

/** Message type: Yjs sync protocol message. */
export const MESSAGE_SYNC = 0;
/** Message type: awareness update. */
export const MESSAGE_AWARENESS = 1;
/** Message type: query awareness (request current awareness state). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for unsupported/invalid data. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** Result of decoding a WebSocket message frame. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes a y-websocket WebSocket message frame.
 *
 * Expected framing (from y-websocket client):
 *   - Binary message: first byte is the message type, remaining bytes are the payload.
 *   - For MESSAGE_SYNC: payload is a lib0-encoded y-protocols sync message.
 *   - For MESSAGE_AWARENESS: payload is the awareness update bytes.
 *   - For MESSAGE_QUERY_AWARENESS: no payload.
 *
 * Returns `{ kind: 'invalid', reason }` for string frames, unknown types,
 * truncated bytes, or any decode error.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // String frames are invalid (y-websocket always sends binary).
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  const bytes = new Uint8Array(data);

  // Need at least 1 byte for the type.
  if (bytes.length < 1) {
    return { kind: 'invalid', reason: 'truncated: empty' };
  }

  const type = bytes[0];
  const payload = bytes.slice(1);

  switch (type) {
    case MESSAGE_SYNC:
      return { kind: 'sync', payload };
    case MESSAGE_AWARENESS:
      return { kind: 'awareness', payload };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown type ${type}` };
  }
}
