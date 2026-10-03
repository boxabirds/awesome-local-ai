/**
 * Board ids: the address of a board.
 *
 * A board id is 16 random bytes (128 bits) rendered as unpadded base64url, so
 * it is 22 characters long and hard to guess (PRD "Security (interim)").
 * Story 5 moves the generation to the server when it introduces board
 * creation; until then the client mints one when it opens `/`.
 */

/** A board id is exactly this many random bytes. */
export const BOARD_ID_BYTES = 16;

/** Unpadded base64url of {@link BOARD_ID_BYTES} bytes: 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Is `id` a well-formed board id? Anything else is rejected with a 400. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** The base64url alphabet, in the order `62 + i` maps a 6-bit value to it. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Unpadded base64url by hand: `btoa` is missing in some runtimes and adds
 * padding, and the id must be exactly 22 characters with no '=' at the end.
 */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL[b0 >> 3];
    out += BASE64URL[((b0 & 0b111) << 3) | ((b1 ?? 0) >> 5)];
    if (b1 !== undefined) out += BASE64URL[((b1 & 0b11111) << 1) | ((b2 ?? 0) >> 7)];
    if (b2 !== undefined) out += BASE64URL[b2 & 0b111111];
  }
  return out;
}

/**
 * A fresh, unguessable board id: {@link BOARD_ID_BYTES} random bytes (128 bits)
 * in unpadded base64url, which is exactly 22 characters.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
