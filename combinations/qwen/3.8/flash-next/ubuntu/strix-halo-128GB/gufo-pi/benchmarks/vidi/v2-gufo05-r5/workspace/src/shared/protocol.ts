/**
 * The wire protocol between a browser tab and a board room.
 *
 * Frames use the y-websocket message framing so a plain `y-websocket` client, the
 * Durable Object and the test clients all speak the same bytes:
 *
 * ```
 * frame       := varUint(type) body
 * sync body   := the y-protocols sync message itself: varUint(step) + its payload
 * awareness   := varUint8Array(update)
 * query       := (nothing)
 * ```
 *
 * Type 0 carries a `y-protocols/sync` message, 1 an awareness update, 3 a request for the
 * current awareness state. A sync frame is not length-prefixed: the rest of the frame belongs
 * to y-protocols, which knows where its own message ends. This is the framing a plain
 * `y-websocket` client speaks, and the room depends on it byte for byte.
 *
 * Awareness is relayed unchanged in this story (the room keeps no presence state);
 * interpreting it is story 6.
 *
 * Anything else - a text frame, bytes that do not decode, an unknown type, or a payload
 * Yjs rejects - closes only the offending socket with `CLOSE_UNSUPPORTED_DATA`.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** Frame type: a `y-protocols/sync` message (SyncStep1 / SyncStep2 / update). */
export const MESSAGE_SYNC = 0;

/** Frame type: an awareness update, relayed verbatim. */
export const MESSAGE_AWARENESS = 1;

/** Frame type: "who is here?" - ignored in this story, the room keeps no awareness. */
export const MESSAGE_QUERY_AWARENESS = 3;

/** WebSocket close code sent to a socket that sent something we cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * What a runtime puts into a WebSocket message event. workerd hands binary frames as a
 * `Blob` (async to read), a plain `ArrayBuffer` or a `Uint8Array` depending on the side of
 * the connection, and a text frame as a `string`.
 */
export type IncomingFrame = string | ArrayBuffer | ArrayBufferView | Blob;

/** The bytes behind an `ArrayBuffer` or a view of one, without copying. */
export function bytesOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

/**
 * Normalizes a received message to bytes, or keeps the text of a text frame so the caller
 * can reject it. Reading a `Blob` is the one asynchronous step of handling a message.
 */
export async function toFrameBytes(message: IncomingFrame): Promise<Uint8Array | string> {
  if (typeof message === 'string') return message;
  if (message instanceof Blob) return new Uint8Array(await message.arrayBuffer());
  return bytesOf(message);
}

/** One decoded frame: its kind plus the bytes the room needs (if any). */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * A frame carrying a sync message, as produced by `y-protocols/sync` (its own type byte is
 * already inside `message`, so the frame is just the outer type followed by it).
 */
export function syncFrame(message: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, message);
  return encoding.toUint8Array(encoder);
}

/**
 * Reads one frame. Never throws: anything unreadable comes back as
 * `{ kind: 'invalid', reason }` so the caller can close that socket and keep the room.
 *
 * The payload is a view of `data`, which the caller owns for the duration of one message.
 */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') {
    // the protocol is binary-only; y-websocket clients never send text frames
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = bytesOf(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty frame' };
  const decoder = decoding.createDecoder(bytes);
  try {
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        // no length prefix: everything that is left is the sync message, and y-protocols
        // decides whether it is complete (a message that runs out of bytes is rejected there)
        return { kind: 'sync', payload: decoder.arr.subarray(decoder.pos) };
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        if (decoder.pos !== decoder.arr.length) {
          return {
            kind: 'invalid',
            reason: 'awareness frame has trailing bytes',
          };
        }
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : 'frame did not decode',
    };
  }
}
