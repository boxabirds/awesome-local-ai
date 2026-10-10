// Story 5 task 1 (TC-04): the link code behind every board URL is 16
// random bytes (128 bits) from the cryptographic source, encoded as a
// 22-character base64url string, and unique across 10,000 generations
// (share.unguessable).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

function base64urlToBytes(id: string): Uint8Array {
  const binary = atob(id.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('board link code (share.unguessable)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-04: 10,000 newBoardId() are all unique, 22 chars, pattern-valid', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('TC-04: each id comes from a cryptographic source of at least 16 bytes', () => {
    const real = crypto.getRandomValues.bind(crypto);
    let lastDraw: Uint8Array | null = null;
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView>(buffer: T): T => {
      real(buffer);
      lastDraw = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      return buffer;
    });

    const id = newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16); // >= 128 bits
    expect(lastDraw).not.toBeNull();
    expect(lastDraw!.byteLength).toBe(BOARD_ID_BYTES);
    // The id decodes back to exactly the bytes the crypto source produced,
    // so nothing but randomness determines it (no time/counter/order input).
    expect(base64urlToBytes(id)).toEqual(lastDraw);
  });

  it('TC-04: the id alphabet survives chat and email transports', () => {
    for (let i = 0; i < 100; i++) {
      expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
