// Board identifiers (story 3). A board is reached by its address
// /b/<boardId>; the id is 16 random bytes encoded base64url without padding
// (22 characters). Story 5 will generate ids server-side on creation.

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** base64url of 16 bytes without padding: 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (22 base64url chars). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

const BASE64_URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encodes bytes as unpadded base64url (16 bytes -> 22 chars). */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_URL_ALPHABET[(n >> 18) & 63];
    out += BASE64_URL_ALPHABET[(n >> 12) & 63];
    out += BASE64_URL_ALPHABET[(n >> 6) & 63];
    out += BASE64_URL_ALPHABET[n & 63];
  }
  const remainder = bytes.length % 3;
  if (remainder === 1) return out.slice(0, -2);
  if (remainder === 2) return out.slice(0, -1);
  return out;
}

/** Generates a fresh random board id (16 random bytes, base64url, 22 chars). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
