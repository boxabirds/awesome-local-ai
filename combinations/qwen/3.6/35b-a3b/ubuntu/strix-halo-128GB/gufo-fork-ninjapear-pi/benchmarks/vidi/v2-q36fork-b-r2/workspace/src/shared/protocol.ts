// y-websocket message framing constants
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
 * Decode a y-websocket wire message.
 * Frame format: [type (1 byte)][payload]
 * Returns decoded result or invalid on any error.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // Reject string frames entirely
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame not supported' };
  }

  // Must be at least 1 byte for the type
  if (data.byteLength < 1) {
    return { kind: 'invalid', reason: 'empty message' };
  }

  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const type = view.getUint8(0);

  switch (type) {
    case MESSAGE_SYNC: {
      const payload = bytes.slice(1);
      return { kind: 'sync', payload };
    }
    case MESSAGE_AWARENESS: {
      const payload = bytes.slice(1);
      return { kind: 'awareness', payload };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}
