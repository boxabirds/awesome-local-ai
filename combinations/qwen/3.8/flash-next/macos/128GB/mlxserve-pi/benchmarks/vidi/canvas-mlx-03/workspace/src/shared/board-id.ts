// Board addressing: a board id is 16 random bytes base64url-encoded (22 chars,
// no padding). Story 5 will mint ids when a board is created; until then the
// client mints one on `/` and the Worker validates every id before creating a
// Durable Object. Framework-free: imported by the Worker, the client and tests.

/** Number of random bytes in a board id (128 bits of randomness). */
export const BOARD_ID_BYTES = 16;

/** Accepts exactly the base64url (no padding) encoding of BOARD_ID_BYTES bytes. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** True when `id` is a well-formed board id (22-char base64url, no padding). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Encode bytes as base64url without padding (environment-agnostic, no btoa). */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL[b0 >> 2];
    if (b1 === undefined) {
      out += B64URL[(b0 & 0x03) << 4];
    } else if (b2 === undefined) {
      out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += B64URL[(b1 & 0x0f) << 2];
    } else {
      out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
      out += B64URL[b2 & 0x3f];
    }
  }
  return out;
}

/** A fresh, unguessable board id: BOARD_ID_BYTES random bytes as base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
