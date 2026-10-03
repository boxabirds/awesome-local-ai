// y-websocket wire protocol: message type constants + frame decoding.
// Shared by the BoardRoom Durable Object (server) and the test suites.
//
// Frame layout (lib0 varUint framing, binary WebSocket frames only):
//   [messageType : varUint, message definition..]
//   - MESSAGE_SYNC (0):          a y-protocols sync message
//     ([syncType : varUint, ..], syncType 0=Step1, 1=Step2, 2=Update)
//   - MESSAGE_AWARENESS (1):     [awareness update : varUint8Array]
//   - MESSAGE_QUERY_AWARENESS (3): no payload

import { createDecoder, readVarUint } from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for non-binary / undecodable / unknown / invalid frames. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/** Close code: board load failed (snapshot unreadable or SQL error). */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** Close code: storage write failure (room reset). */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a WebSocket frame into a typed message.
 *
 * For `sync` and `awareness`, `payload` is the full frame bytes (starting at
 * the message-type byte) so it can be fed to `y-protocols` readers or relayed
 * verbatim. Any frame that is not a binary y-websocket frame yields
 * `{ kind: 'invalid', reason }`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  const decoder = createDecoder(bytes);
  let type: number;
  try {
    type = readVarUint(decoder);
  } catch {
    return { kind: 'invalid', reason: 'truncated message type' };
  }
  switch (type) {
    case MESSAGE_SYNC:
      // Full frame (type byte included): feed to y-protocols sync readers.
      return { kind: 'sync', payload: bytes };
    case MESSAGE_AWARENESS:
      // Full frame: relayed verbatim to every socket.
      return { kind: 'awareness', payload: bytes };
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}
