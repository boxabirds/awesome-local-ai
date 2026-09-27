import { WORKSPACE_SECRET_BYTES } from '@todoodle/shared/limits';

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A new workspace secret: WORKSPACE_SECRET_BYTES random bytes, base64url without padding (43 chars). */
export function generateSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(WORKSPACE_SECRET_BYTES)));
}

/** SHA-256 of the secret as 64 lowercase hex characters. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

type TimingSafeSubtle = SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };

/**
 * Constant-time comparison. On a length mismatch it still walks the full length of `a` before
 * returning false, so there is no early exit on the first differing character.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const sameLength = left.byteLength === right.byteLength;
  const other = sameLength ? right : left;
  const subtle = crypto.subtle as TimingSafeSubtle;
  let equal: boolean;
  if (typeof subtle.timingSafeEqual === 'function') {
    equal = subtle.timingSafeEqual(left, other);
  } else {
    let diff = 0;
    for (let i = 0; i < left.byteLength; i++) diff |= left[i]! ^ other[i]!;
    equal = diff === 0;
  }
  return sameLength && equal;
}

/** True only for exactly 43 base64url characters (the shape generateSecret produces). */
export function isWellFormedSecret(s: unknown): s is string {
  return typeof s === 'string' && SECRET_PATTERN.test(s);
}
