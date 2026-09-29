// Story 3: board ids (anchor: sync.worker_entry).
//
// A board id is 16 random bytes encoded as unpadded base64url: exactly 22
// characters from [A-Za-z0-9_-]. Both the worker (route validation) and the
// client (URL routing) validate with the same function, so an invalid id can
// never allocate a room.

import { toBase64UrlEncoded } from 'lib0/buffer';

/** Randomness, in bytes, behind every board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** 16 bytes -> 22 unpadded base64url characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (see BOARD_ID_PATTERN). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a fresh board id: BOARD_ID_BYTES of crypto randomness encoded as
 * unpadded base64url.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // toBase64UrlEncoded: unpadded, uses - and _ (exactly 22 chars for 16 bytes).
  return toBase64UrlEncoded(bytes);
}
