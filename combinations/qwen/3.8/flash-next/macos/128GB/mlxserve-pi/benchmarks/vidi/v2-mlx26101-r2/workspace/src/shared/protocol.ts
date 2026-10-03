/**
 * The wire protocol between the browser (`y-websocket`'s `WebsocketProvider`)
 * and the `BoardRoom` Durable Object.
 *
 * Every WebSocket message is framed the way `y-websocket` frames it: a varuint
 * message type, then the payload of the corresponding `y-protocols` message.
 * These constants and helpers are shared by the room and by the tests; the
 * client provider speaks exactly this framing.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** Frame type of a `y-protocols/sync` message (SyncStep1/2, Update). */
export const MESSAGE_SYNC = 0;
/** Frame type of an `y-protocols/awareness` update. */
export const MESSAGE_AWARENESS = 1;
/** Frame type of an awareness query (`y-websocket`'s `messageQueryAwareness`). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code sent to a socket whose message cannot be understood (RFC 6455 1003). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * A decoded WebSocket message.
 *
 * `payload` is the raw bytes that follow the message-type varuint — the
 * `y-protocols` message body: ready for `readSyncMessage` (sync), or relayed
 * after an awareness frame type (awareness).
 */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** Everything `decoder` has not consumed yet (and advance it to the end). */
const rest = (decoder: decoding.Decoder): Uint8Array => decoding.readTailAsUint8Array(decoder);

/**
 * Decode one y-websocket framed message. Nothing here throws: every malformed
 * input — a text frame, an empty buffer, a truncated varuint, an unknown
 * message type — comes back as `{ kind: 'invalid', reason }`, and the caller
 * decides what to do with it (the room closes that socket with
 * {@link CLOSE_UNSUPPORTED_DATA}).
 *
 * A *well-formed* sync frame can still carry an invalid Yjs update; that is
 * only detected when the update is applied, which is `readSyncMessage`'s job,
 * not this one's.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }

  let decoder: decoding.Decoder;
  let type: number;
  try {
    decoder = decoding.createDecoder(bytes);
    type = decoding.readVarUint(decoder);
  } catch (error) {
    return { kind: 'invalid', reason: `unreadable message type: ${(error as Error).message}` };
  }

  switch (type) {
    case MESSAGE_SYNC: {
      const payload = rest(decoder);
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'sync message without a body' };
      }
      return { kind: 'sync', payload };
    }
    case MESSAGE_AWARENESS: {
      const payload = rest(decoder);
      try {
        // Validate the length prefix in a second pass, so `payload` keeps the
        // whole body: a truncated update must not be relayed.
        const update = decoding.readVarUint8Array(decoding.createDecoder(payload));
        if (update.byteLength === 0) {
          return { kind: 'invalid', reason: 'awareness message without an update' };
        }
      } catch (error) {
        return {
          kind: 'invalid',
          reason: `truncated awareness message: ${(error as Error).message}`,
        };
      }
      return { kind: 'awareness', payload };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` };
  }
}

/**
 * Wrap a `y-protocols` message body in the y-websocket frame of `type`.
 * `readSyncMessage` writes a reply body without the outer frame type, so the
 * room builds its replies with this.
 */
export function frameMessage(type: number, body: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
}
