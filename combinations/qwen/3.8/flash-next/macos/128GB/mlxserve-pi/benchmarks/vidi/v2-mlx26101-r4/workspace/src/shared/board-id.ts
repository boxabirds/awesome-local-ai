/**
 * Board addresses: what one looks like, and how to make a new one.
 *
 * A board is reached only by its address (story 3 has no "new board" button), so
 * the address is the whole access control for now: anyone who has it can edit,
 * nobody who does not have it can find the board. That only works while the
 * address is impossible to guess, which is why it is 128 random bits rather than
 * a counter or a slug, and why the Worker refuses anything that is not shaped
 * like one before it starts a room for it.
 */

import { BOARD_ID_BYTES } from './config';

/**
 * A board id as it appears in a URL: base64url of BOARD_ID_BYTES bytes, with the
 * `=` padding left off (22 characters for 16 bytes). Fixed length and no `/`,
 * `?` or `#`, so an id is always exactly one path segment.
 */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board address; nothing else is looked up. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** The characters of base64url, in the order a 6-bit value maps to them. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A new board address: BOARD_ID_BYTES random bytes, written as base64url without
 * padding (22 characters). Written by hand rather than with `btoa` because the
 * browser's `atob`/`btoa` speak base64, not base64url, and would have to be
 * rewritten anyway — and because this runs the same way in the Worker.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let index = 0; index < bytes.length; index += 3) {
    // One to three bytes left in this group, packed big-endian into `value`.
    const remaining = Math.min(3, bytes.length - index);
    let value = 0;
    for (let offset = 0; offset < remaining; offset += 1) {
      value = (value << 8) | bytes[index + offset];
    }
    // Six bits per character. A short final group is zero-filled to the next
    // whole character, exactly as base64 does before it drops the `=` padding,
    // so 16 bytes come to 22 characters (5 groups of 4 plus one byte's 2).
    const pad = (6 - (remaining * 8) % 6) % 6;
    value <<= pad;
    for (let shift = remaining * 8 + pad - 6; shift >= 0; shift -= 6) {
      id += BASE64URL[(value >>> shift) & 0b111111];
    }
  }
  return id;
}
