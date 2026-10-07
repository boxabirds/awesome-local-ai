/**
 * Board addresses. A board is reached by its URL (`/b/:boardId`), so the id has
 * to be unguessable even before story 5 introduces server-side board creation:
 * 128 random bits, written as unpadded base64url (22 characters).
 *
 * This module is shared by the client (which generates one when you open `/`)
 * and the Worker (which validates the route parameter).
 */

/** Random bytes per board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** Exactly the base64url encoding of `BOARD_ID_BYTES` bytes, without padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board address (nothing else is checked). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Unpadded base64url (RFC 4648 §5) written by hand so the same code runs in the
 * browser, in workerd and in Node without depending on `btoa`/`Buffer`.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const chunk =
      (bytes[i]! << 16) |
      ((remaining > 1 ? bytes[i + 1]! : 0) << 8) |
      (remaining > 2 ? bytes[i + 2]! : 0);
    out += BASE64URL[(chunk >> 18) & 63]! + BASE64URL[(chunk >> 12) & 63]!;
    if (remaining > 1) out += BASE64URL[(chunk >> 6) & 63]!;
    if (remaining > 2) out += BASE64URL[chunk & 63]!;
  }
  return out;
}

/** A fresh, unguessable board id (`crypto.getRandomValues`, 16 bytes). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
