import * as decoding from 'lib0/decoding';

/**
 * The wire framing of `/api/rooms/:boardId`, shared by the BoardRoom Durable Object and
 * by the tests that speak it.
 *
 * A client message is one binary WebSocket frame:
 *
 * ```text
 * varUint(message type) [payload]
 * ```
 *
 * with the types of the y-websocket protocol: `0` carries a `y-protocols/sync` message,
 * `1` an awareness update and `3` an awareness query. The browser side of the connection
 * is `WebsocketProvider` from `y-websocket`, which uses exactly these numbers, so the
 * room and a real browser speak the same bytes - and the integration tests speak them
 * too, with the same `lib0` encoders.
 */

/** Frame type of a `y-protocols/sync` message (sync step 1, step 2 or an update). */
export const MESSAGE_SYNC = 0;
/** Frame type of an awareness update. */
export const MESSAGE_AWARENESS = 1;
/** Frame type of an awareness query ("who is there?"). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code sent to a socket that sent something undecodable (RFC 6455 §7.4.1). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** A frame that decoded, with the reason it did not otherwise. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * The bytes of a frame that arrived on a WebSocket, in whatever shape the runtime handed it over.
 *
 * A frame sent by something inside the same runtime arrives as an `ArrayBuffer`. A frame that
 * comes in through a proxy in front of the runtime - which is how every browser's socket
 * reaches a room, in local dev and at the edge - arrives as a `Blob` holding those same bytes,
 * and reading it takes a wait. Text stays text: the room refuses it either way, and refusing
 * it is the caller's decision, not this function's.
 *
 * Getting this wrong is not a subtle bug: the bytes of a `Blob` read as an `ArrayBuffer` are no
 * bytes at all, so the frame looks empty and the room hangs up on the very first thing a
 * browser sends. That is a board that never loads, in a browser, and nothing anywhere else.
 */
export async function frameData(data: ArrayBuffer | Blob | string): Promise<ArrayBuffer | string> {
  return data instanceof Blob ? await data.arrayBuffer() : data;
}

/**
 * Split one received WebSocket frame into its type and payload.
 *
 * Anything the room cannot act on comes back as `{ kind: 'invalid' }` - a text frame, an
 * empty or truncated frame, or an unknown type - and the caller closes that one socket
 * with {@link CLOSE_UNSUPPORTED_DATA}. A `Blob` is not one of its inputs: run it through
 * {@link frameData} first.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'expected a binary frame, got text' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
      case MESSAGE_AWARENESS: {
        const payload = remaining(decoder);
        if (payload.byteLength === 0) {
          return { kind: 'invalid', reason: `message type ${type} has no payload` };
        }
        return type === MESSAGE_SYNC
          ? { kind: 'sync', payload }
          : { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return { kind: 'invalid', reason: `undecodable frame: ${describeError(error)}` };
  }
}

/** Everything the decoder has not read yet, as bytes the caller may keep. */
function remaining(decoder: decoding.Decoder): Uint8Array {
  const left = decoder.arr.length - decoder.pos;
  if (left <= 0) {
    return new Uint8Array(0);
  }
  // Read it through lib0: `decoder.arr` may be a view on a larger buffer, and the
  // payload has to outlive the frame it came in.
  return Uint8Array.from(decoding.readUint8Array(decoder, left));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
