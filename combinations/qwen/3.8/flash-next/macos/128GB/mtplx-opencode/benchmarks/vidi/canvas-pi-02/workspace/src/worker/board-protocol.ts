/**
 * The wire between a board room and a board client (story 4).
 *
 * Story 3's lesson, restated because story 4 depends on it: what travels over
 * the socket is *framed*, not self-describing. One binary message carries a
 * one-byte message type, and inside a sync message a one-byte sync type, and
 * everything after that is length-prefixed bytes. A relay that copies frames
 * without reading that much cannot tell a board update from an awareness ping,
 * and "forward everything" quietly becomes "forward the wrong things".
 *
 * So this file owns the *shape* half of that, and one shape is not enough:
 *
 *  - a `WebSocketPair` created inside a Durable Object keeps the frame type, so
 *    `send(ArrayBuffer)` arrives as an `ArrayBuffer` and `send(string)` arrives
 *    as a `string`;
 *  - the client library in this repo (y-websocket 2.1) sends raw binary and
 *    declares no subprotocol, while its older profile docs describe a `base64`
 *    protocol in which the same bytes travel as `"base64,<text>"`.
 *
 * A room that only understands one shape breaks at the layer *under* the
 * message types, so `frameToBytes` accepts both and `frameToReply` answers in
 * whichever shape arrived. What the bytes *mean* stays the job of
 * `../shared/protocol`'s `decodeMessage`: this file turns a frame into bytes
 * and bytes back into a frame, and nothing else.
 */

/** How a sender framed its message, which is how the room answers. */
export type FrameShape = 'binary' | 'text';

/** The prefix that marks a text frame as base64-encoded protocol bytes. */
export const BASE64_PREFIX = 'base64,';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/** Decode a base64 body (no prefix) into bytes, or `null` if it is not base64. */
export function decodeBase64(body: string): Uint8Array | null {
  if (body.length % 4 !== 0) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = BASE64_ALPHABET.indexOf(body.charAt(index));
    if (value === -1) return null;
    if (value === 64) break; // '=' padding: the rest is filler
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits === 24) {
      bytes.push((buffer >> 16) & 0xff, (buffer >> 8) & 0xff, buffer & 0xff);
      buffer = 0;
      bits = 0;
    }
  }
  return Uint8Array.from(bytes);
}

/** Encode bytes as base64 (no prefix), for a text reply. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    buffer = (buffer << 8) | bytes[index]!;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64_ALPHABET.charAt((buffer >> bits) & 0x3f);
    }
  }
  if (bits > 0) out += BASE64_ALPHABET.charAt((buffer << (6 - bits)) & 0x3f);
  while (out.length % 4 !== 0) out += '=';
  return out;
}

/** The shape a message arrived in, or `null` for something that is not a frame. */
export function frameShape(data: ArrayBuffer | ArrayBufferView | string): FrameShape | null {
  if (typeof data === 'string') return data.startsWith(BASE64_PREFIX) ? 'text' : null;
  return 'binary';
}

/**
 * The protocol bytes of one incoming message, whatever shape it arrived in.
 *
 * `null` means "not protocol bytes at all" — a bare text frame, a base64 body
 * that does not decode — and the room's answer to that is to close the sender,
 * never to guess. Guessing is how a relay corrupts a board.
 */
export function frameToBytes(
  data: ArrayBuffer | ArrayBufferView | string,
): Uint8Array | null {
  if (typeof data === 'string') {
    if (!data.startsWith(BASE64_PREFIX)) return null;
    return decodeBase64(data.slice(BASE64_PREFIX.length));
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return new Uint8Array(data.slice(0));
}

/**
 * A frame to send back, in the shape `data` arrived in.
 *
 * A client built on the base64 profile decodes `"base64,…"` because that is the
 * profile it was built with; a binary client decodes bytes. Answering in the
 * sender's shape is what lets one room serve both without knowing which it has.
 */
export function frameToReply(
  shape: FrameShape,
  bytes: Uint8Array,
): ArrayBuffer | string {
  if (shape === 'text') return `${BASE64_PREFIX}${encodeBase64(bytes)}`;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The close code a room uses when it could not load the board. */
export const CLOSE_CODE_LOAD_FAILED = 4006;

/** The close reason that goes with {@link CLOSE_CODE_LOAD_FAILED}. */
export const CLOSE_REASON_LOAD_FAILED = 'load-failed';

/**
 * Is this close the "the room could not load the board" close?
 *
 * Either half on its own is enough: a client that reads the code, a client that
 * reads the reason. That is deliberate, because the two halves are written by
 * different layers (the room writes both, a test harness may write one) and a
 * board that is merely unreachable must not be reported as a board that failed
 * to load.
 */
export function isLoadFailureClose(
  code: number | undefined,
  reason: string | undefined,
): boolean {
  return (
    code === CLOSE_CODE_LOAD_FAILED ||
    (reason !== undefined && reason.startsWith(CLOSE_REASON_LOAD_FAILED))
  );
}
