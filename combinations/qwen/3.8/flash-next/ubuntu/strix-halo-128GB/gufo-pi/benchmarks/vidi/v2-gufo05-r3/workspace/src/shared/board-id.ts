/**
 * Board addresses. A board is reached by its address (`/b/<boardId>`, and the
 * matching `/api/rooms/<boardId>` WebSocket route), so an address must be hard
 * to guess: 128 bits of randomness, written as 22 base64url characters.
 */

/** Random bytes behind a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url (no padding) encoding of {@link BOARD_ID_BYTES} bytes: 22 chars. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** The base64url alphabet (RFC 4648 §5), no padding character. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** True when `id` is a well-formed board id (and nothing else). */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/**
 * Encode bytes as base64url without padding.
 *
 * Hand-rolled instead of `btoa` so it behaves identically in the browser, in
 * Node and in Workers, and never emits `+`, `/` or `=`.
 */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[(b0 & 0b11) << 4 | (b1 ?? 0) >> 4];
    if (b1 === undefined) break;
    out += ALPHABET[(b1 & 0b1111) << 2 | (b2 ?? 0) >> 6];
    if (b2 === undefined) break;
    out += ALPHABET[b2 & 0b111111];
  }
  return out;
}

/** A fresh board id: {@link BOARD_ID_BYTES} random bytes, base64url, 22 chars. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
