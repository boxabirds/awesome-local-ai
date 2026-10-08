/**
 * Board addresses (story 3).
 *
 * A board id is 16 random bytes (128 bits) rendered as base64url without
 * padding, i.e. exactly 22 characters from the URL-safe alphabet.  The same
 * helper is used by the Worker (validation) and the client (temporary `/`
 * redirect), so it lives in `src/shared`.
 */

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16

/** base64url of 16 bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** True when `id` is a well-formed board address (length 22, base64url alphabet). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id)
}

/** Encode bytes as base64url without padding (22 chars for 16 bytes). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1
    out += BASE64URL[b0 >> 2]
    out += BASE64URL[((b0 & 0b0000_0011) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
    if (b1 < 0) break
    out += BASE64URL[((b1 & 0b0000_1111) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
    if (b2 < 0) break
    out += BASE64URL[b2 & 0b0011_1111]
  }
  return out
}

/** Generate a fresh, unguessable board address (22 chars). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}
