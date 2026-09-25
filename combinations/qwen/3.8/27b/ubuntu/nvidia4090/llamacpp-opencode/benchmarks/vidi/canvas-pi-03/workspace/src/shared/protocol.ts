/**
 * y-websocket wire framing shared by the Durable Object, the integration
 * test clients and (structurally) the browser provider.
 *
 * Every WebSocket message is: [type: varUint][payload...]. The outer type
 * values 0, 1 and 3 are the y-websocket message types; 2 is reserved for
 * auth, which this product does not use.
 */
import { createDecoder, readVarUint } from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

/**
 * Close code the room uses for traffic it cannot interpret (non-binary
 * frames, unknown message types, undecodable bytes, invalid Yjs updates).
 * 1003 = "unsupported data" (RFC 6455). The y-websocket client treats this
 * as transient and reconnects, then fully resyncs.
 */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decodes one y-websocket frame. Never throws: any malformed input
 * (string frame, empty frame, unknown type, truncated payload) yields
 * `{ kind: 'invalid' }`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  const decoder = createDecoder(bytes);
  let type: number;
  try {
    type = readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'undecodable type' };
  }
  // The frame is [type varUint][payload]; payload is everything after.
  const payload = bytes.slice(decoder.pos);
  switch (type) {
    case MESSAGE_SYNC:
      if (payload.length === 0) return { kind: 'invalid', reason: 'truncated sync frame' };
      return { kind: 'sync', payload };
    case MESSAGE_AWARENESS:
      if (payload.length === 0) return { kind: 'invalid', reason: 'truncated awareness frame' };
      return { kind: 'awareness', payload };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}
