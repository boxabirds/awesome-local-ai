/**
 * Story 3 · the wire framing shared by the Durable Object and the tests
 * (design "BoardRoom Durable Object").
 *
 * The y-websocket provider and the reference server frame every WebSocket
 * frame as `[messageType: varUint, ...body]`. The message-type byte is one of
 * the four constants below; everything after it is protocol-specific. This
 * module owns only the decoding so a bad frame can be turned into a single
 * `close(1003)` decision in one place; the `BoardRoom` then interprets a valid
 * `sync` body with `y-protocols/sync`.
 */
import * as decoding from 'lib0/decoding';

/* The four y-websocket message types (identical numbers to `y-websocket` and
 * the reference server). */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

/** WebSocket close code sent for a non-binary / undecodable / unknown frame. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Normalise a raw WebSocket message body to a flat `ArrayBuffer`, or `null` if
 * it is text. The `BoardRoom` sets `binaryType = 'arraybuffer'` so binary
 * frames normally arrive as an `ArrayBuffer`, but a `Uint8Array` view or an
 * `ArrayBuffer` with a non-zero `byteOffset` are also handled so the copied
 * buffer handed to the decoders always starts at byte 0.
 */
export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView | string): ArrayBuffer | null {
  if (typeof data === 'string') return null;
  if (data instanceof ArrayBuffer) return data;
  const view = data as ArrayBufferView;
  return (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
}

/**
 * Classify one raw WebSocket message.
 *
 * - A text frame is never legitimate (the provider is always binary) → invalid.
 * - `sync` returns the body *after* the message-type byte, so the caller can
 *   hand it straight to `syncProtocol.readSyncMessage`, which starts by reading
 *   the sync sub-type.
 * - `awareness` returns the whole frame verbatim so the room can relay exactly
 *   what it received (including the message-type byte) to every other socket.
 * - Truncated bytes, unknown types or any decode error are reported as
 *   `invalid` rather than thrown, so the room's error path is uniform.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };

  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) return { kind: 'invalid', reason: 'empty frame' };

  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // A sync frame is [type, subType, varUint8Array(payload)]. Read the
        // sub-type and consume the payload so a truncation is caught here.
        const subType = decoding.readVarUint(decoder);
        if (subType > 2) return { kind: 'invalid', reason: 'unknown sync type' };
        decoding.readVarUint8Array(decoder); // throws if truncated
        // Hand the caller everything after the message-type byte.
        return { kind: 'sync', payload: bytes.subarray(1) };
      }
      case MESSAGE_AWARENESS: {
        // A awareness frame is [type, varUint8Array(update)].
        decoding.readVarUint8Array(decoder); // throws if truncated
        return { kind: 'awareness', payload: bytes };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'decode error' };
  }
}
