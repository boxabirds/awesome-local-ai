import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

describe('link codes (TC-04, share.unguessable)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('TC-04 10,000 ids are unique, 22 chars, URL-safe', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('draws 16 bytes (128 bits) from the cryptographic source', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
  });

  it('named settings exist', () => {
    expect([CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS]).toEqual([2000, 2000, 1000]);
  });
});
