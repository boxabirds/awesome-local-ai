// Story 5 TC-04 (share.unguessable): link codes are 128 random bits, 22 characters, distinct.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('board link codes (share.board_api)', () => {
  it('TC-04: 10,000 newBoardId() are unique, 22 characters and match BOARD_ID_PATTERN', () => {
    const ids = Array.from({ length: 10_000 }, () => newBoardId());
    expect(new Set(ids).size).toBe(10_000);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
    }
  });

  it('TC-04: each code comes from 16 bytes (128 bits) of the cryptographic random source', () => {
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    const spy = vi.spyOn(crypto, 'getRandomValues');
    newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    const bytes = spy.mock.calls[0]![0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(16);
  });

  it('TC-04: the code encodes exactly those random bytes (not time or a counter)', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
      array.set(fixed);
      return array;
    }) as unknown as typeof crypto.getRandomValues);
    const id = newBoardId();
    const decoded = Uint8Array.from(atob(id.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(fixed));
  });
});
