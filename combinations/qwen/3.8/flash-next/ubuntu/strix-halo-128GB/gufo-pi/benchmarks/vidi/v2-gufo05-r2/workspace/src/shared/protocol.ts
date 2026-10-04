/**
 * The wire protocol between the browser (`y-websocket` client provider) and the
 * `BoardRoom` Durable Object. One outer frame type byte (a lib0 varUint) followed
 * by the payload of the corresponding `y-protocols` message. Shared by the room
 * and by the integration tests, which speak exactly the same framing as the
 * browser provider.
 */

import * as decoding from 'lib0/decoding';

/** y-websocket frame type: payload is a `y-protocols/sync` message. */
export const MESSAGE_SYNC = 0;
/** y-websocket frame type: payload is a `y-protocols/awareness` update. */
export const MESSAGE_AWARENESS = 1;
/** y-websocket frame type: "who is here?" — no payload. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code: endpoint received data of an unexpected type. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Split one WebSocket message into its frame type and payload. Never throws:
 * a text frame, a truncated varUint header, an unknown frame type or a
 * payload-less sync/awareness frame all come back as `{ kind: 'invalid' }` with
 * a human-readable reason (the room closes that socket, nothing else).
 */
export function decodeMessage(data: ArrayBuffer | Uint8Array | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported: frames are binary' };
  }
  // The runtime hands binary frames over as either an ArrayBuffer or a view
  // onto one, depending on the socket flavour.
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let decoder: decoding.Decoder;
  let type: number;
  try {
    decoder = decoding.createDecoder(bytes);
    type = decoding.readVarUint(decoder);
  } catch (error) {
    return { kind: 'invalid', reason: `truncated or undecodable frame header: ${reason(error)}` };
  }
  switch (type) {
    case MESSAGE_SYNC:
    case MESSAGE_AWARENESS: {
      // Every y-protocols message starts with at least its own varUint type, so
      // a frame with a header and no payload cannot be a real message.
      if (!decoding.hasContent(decoder)) {
        return { kind: 'invalid', reason: `frame type ${type} carries no y-protocols payload` };
      }
      const payload = decoding.readTailAsUint8Array(decoder);
      return type === MESSAGE_SYNC ? { kind: 'sync', payload } : { kind: 'awareness', payload };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown frame type ${type}` };
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
