/**
 * Board id helpers (design §2, §7).
 *
 * A board id is 128 bits of randomness rendered as a 22-character URL-safe
 * string. We keep our own base64url helpers because `Buffer`'s `base64url` is
 * not available inside the Worker and adds `=` padding that would leak into the
 * room URL; a board id must decode to exactly 16 bytes.
 *
 * A 22-character id carries 132 bits: the last character shares one byte with
 * the previous character, so only its top six bits are meaningful. `decodeBoardId`
 * enforces that the two unused bits are zero, which means only 1 in 64
 * twenty-two-character strings is a valid id — an id that is valid but was not
 * produced by `newBoardId` still resolves to a real 16-byte relay key.
 */

const ID_BYTES = 16;
const ID_LENGTH = 22;

const BASE64_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

/** True when every character is in the URL-safe base64 alphabet. */
function isBase64UrlChar(char: string): boolean {
  return BASE64_ALPHABET.indexOf(char) !== -1;
}

/** 16 raw bytes → 22-character URL-safe id (no padding). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A valid id is exactly 22 URL-safe characters that decode to exactly 16 bytes.
 * We deliberately do NOT require the padding to be present (the canonical form
 * has none) and we DO require the trailing character to have zeroed its two
 * unused bits, so `invalid_board_id`-style strings are rejected here.
 */
export function isBoardId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === ID_LENGTH &&
    [...value].every(isBase64UrlChar)
  );
}

/** Raw 16-byte id, or null when `encoded` is not a valid board id. */
export function decodeBoardId(encoded: unknown): Uint8Array | null {
  if (!isBoardId(encoded)) return null;
  let binary: string;
  try {
    // Re-add the two `=` characters the 16-byte encoding elides, then decode.
    binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '==');
  } catch {
    return null;
  }
  if (binary.length !== ID_BYTES) return null;
  const bytes = new Uint8Array(ID_BYTES);
  for (let index = 0; index < ID_BYTES; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // The last character must be exactly the six bits `bytesToBase64Url` emitted,
  // i.e. the reverse must reproduce the input. This rejects a trailing character
  // that only *looks* like base64url.
  return bytesToBase64Url(bytes) === encoded ? bytes : null;
}

/** A fresh, unguessable board id (128 random bits). */
export function newBoardId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Encode a raw 16-byte id back into its URL-safe string form. */
export function encodeBoardId(id: Uint8Array): string {
  return bytesToBase64Url(id);
}
