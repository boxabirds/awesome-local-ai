/**
 * The y-websocket wire framing, shared by the BoardRoom and the tests.
 *
 * Every frame is `varUint(messageType) + content`. Story 3 uses three types:
 * sync (y-protocols messages), awareness (opaque bytes the room relays) and
 * query-awareness (a request for other clients' awareness, which the room
 * ignores because it stores none).
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** y-websocket message types. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code used for traffic this room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Split one incoming frame into its type and payload.
 * Anything unreadable — a text frame, an unknown type, a truncated varUint, a
 * known type with no content — comes back as `{ kind: 'invalid' }`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not part of the protocol' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }

  try {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: readRest(decoder, 'sync') };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: readLengthPrefixed(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (cause) {
    return {
      kind: 'invalid',
      reason: cause instanceof Error ? cause.message : 'undecodable message',
    };
  }
}

/** Everything after the type varUint; a known type with no content is malformed. */
function readRest(decoder: decoding.Decoder, name: string): Uint8Array {
  if (!decoding.hasContent(decoder)) {
    throw new Error(`${name} message has no payload`);
  }
  return decoding.readTailAsUint8Array(decoder);
}

/**
 * An awareness frame is `varUint(updateLength) + update`. The room relays that
 * tail verbatim, so the returned payload keeps the length prefix; a declared
 * length that does not match what is actually there is a truncated frame.
 */
function readLengthPrefixed(decoder: decoding.Decoder): Uint8Array {
  if (!decoding.hasContent(decoder)) {
    throw new Error('awareness message has no payload');
  }
  const start = decoder.pos;
  const length = decoding.readVarUint(decoder);
  const remaining = decoder.arr.length - decoder.pos;
  if (length === 0) {
    throw new Error('awareness update is empty');
  }
  if (remaining !== length) {
    throw new Error(`awareness update declares ${length} bytes, frame has ${remaining}`);
  }
  decoder.pos = start;
  return decoding.readTailAsUint8Array(decoder);
}

/**
 * Frame a payload the way the protocol expects: `varUint(type) + content`.
 * `undefined` payload means the message type stands alone (query-awareness).
 */
export function encodeFrame(type: number, payload?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (payload !== undefined) {
    encoding.writeVarUint8Array(encoder, payload);
  }
  return encoding.toUint8Array(encoder);
}

/** Copy a frame into a standalone ArrayBuffer (workerd hands over Buffer views). */
export function toArrayBuffer(data: string | ArrayBuffer | Uint8Array): ArrayBuffer | string {
  if (typeof data === 'string' || data instanceof ArrayBuffer) {
    return data;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
