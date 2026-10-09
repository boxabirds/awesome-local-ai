/**
 * Board addresses.
 *
 * A board id is the whole of a board's address (`/b/<id>`, `/api/rooms/<id>`): the
 * Worker routes every connection with the same id to the same Durable Object, so ids
 * must be unguessable long before story 5 introduces board creation.
 */

/** Random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** base64url of `BOARD_ID_BYTES` bytes with the padding removed: 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (nothing else is accepted by the Worker). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** base64url alphabet: the two characters base64 spells `+` and `/` are replaced. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode the last group of a base64 string without padding, so a 16 byte id becomes
 * exactly 22 characters (`ceil(16 * 8 / 6)`).
 */
function encodeGroup(bytes: Uint8Array, start: number): string {
  const left = bytes.length - start;
  const chunk =
    (bytes[start] ?? 0) * 65536 + (bytes[start + 1] ?? 0) * 256 + (bytes[start + 2] ?? 0);
  // 3 bytes -> 4 characters, 2 -> 3, 1 -> 2.
  const characters = left >= 3 ? 4 : left + 1;
  let out = '';
  for (let i = 0; i < characters; i += 1) {
    out += BASE64URL[(chunk >>> (18 - 6 * i)) & 63];
  }
  return out;
}

/** A fresh board id: `BOARD_ID_BYTES` random bytes, base64url encoded without padding. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let start = 0; start < bytes.length; start += 3) id += encodeGroup(bytes, start);
  return id;
}
