// Board addresses. A board is reached purely by its address (`/b/<id>`) in this
// story, so the id must be unguessable and must round-trip through a URL path
// and a WebSocket path segment without escaping. 16 random bytes base64url with
// no padding is exactly 22 characters of [A-Za-z0-9_-].

/** Bytes of randomness in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url of BOARD_ID_BYTES with no padding: exactly 22 URL-safe chars. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** True when `id` is a well-formed board id (never throw; used by the Worker). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * A fresh, unguessable board id: `BOARD_ID_BYTES` random bytes encoded as
 * base64url without padding (22 characters). The encoder is written over the
 * alphabet directly so the function needs neither `btoa` nor `Buffer` and runs
 * identically in the browser, in workerd and in Node.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Unpadded base64url (RFC 4648 §5) of `bytes`. */
function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const n =
      (bytes[i] << 16) |
      ((remaining > 1 ? bytes[i + 1] : 0) << 8) |
      (remaining > 2 ? bytes[i + 2] : 0);
    out += BASE64URL_CHARS[(n >> 18) & 63];
    out += BASE64URL_CHARS[(n >> 12) & 63];
    if (remaining > 1) out += BASE64URL_CHARS[(n >> 6) & 63];
    if (remaining > 2) out += BASE64URL_CHARS[n & 63];
  }
  return out;
}
