/**
 * The wire protocol between the browser provider (`y-websocket`) and the
 * `BoardRoom` Durable Object.
 *
 * A message is one binary WebSocket frame: a varuint message type followed by a
 * payload. Sync payloads follow the type directly; awareness payloads are
 * length-prefixed — exactly how `y-websocket` writes them, which is why the
 * helpers here use the same `lib0` encoders.
 */

import * as decoding from 'lib0/decoding';

/** `y-websocket` message type: a `y-protocols/sync` message. */
export const MESSAGE_SYNC = 0;
/** `y-websocket` message type: an `y-protocols/awareness` update. */
export const MESSAGE_AWARENESS = 1;
/** `y-websocket` message type: "send me every awareness state". */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for data that cannot be processed (RFC 6455). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** A frame that was understood, or the reason it was not. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * The bytes of a received WebSocket frame, however the runtime delivered it.
 *
 * A binary message arrives as a `Blob` on the platform, while tests and other
 * runtimes hand over an `ArrayBuffer` or a `Uint8Array`; all three are accepted
 * here so nothing downstream has to know. `null` means "not binary at all", which
 * is the caller's signal to close the connection.
 */
export async function frameBytes(data: unknown): Promise<Uint8Array | null> {
  if (typeof data === 'string') return null;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/**
 * Split one incoming WebSocket frame into its type and payload.
 *
 * Anything the room cannot act on comes back as `{ kind: 'invalid' }` — a text
 * frame, a frame that is too short, a truncated payload or an unknown message
 * type — so the caller can close just that connection.
 */
export function decodeMessage(data: Uint8Array | string): Decoded {
  // The room speaks binary only; a text frame is a protocol error.
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frames are not supported' };

  const decoder = decoding.createDecoder(data);

  try {
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        // A sync payload is not length-prefixed: it runs to the end of the frame.
        return { kind: 'sync', payload: decoding.readTailAsUint8Array(decoder) };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : 'frame could not be decoded'
    };
  }
}

/**
 * The room's storage cannot read this board (story 4). The client must not
 * present it as an empty editable board: it shows a message and keeps retrying.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/** The room could not write to storage, so nothing was saved (story 4). */
export const CLOSE_STORAGE_FAILURE = 1011;
