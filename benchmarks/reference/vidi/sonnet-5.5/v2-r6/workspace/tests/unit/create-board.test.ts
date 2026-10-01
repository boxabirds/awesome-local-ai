import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';

describe('link codes (TC-04, share.unguessable)', () => {
  it('10,000 ids are unique, 22 characters and match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('comes from 16 cryptographically random bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
    const spy = vi.spyOn(crypto, 'getRandomValues');
    newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
    spy.mockRestore();
  });
});
