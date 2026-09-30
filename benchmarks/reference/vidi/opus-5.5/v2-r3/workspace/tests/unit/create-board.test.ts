// TC-04 (share.unguessable): board link codes are 128 random bits, 22 characters, unique.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

afterEach(() => vi.restoreAllMocks());

function decodeBase64url(id: string): Uint8Array {
  const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

describe('newBoardId link codes (TC-04)', () => {
  it('10,000 codes are distinct, 22 characters and match BOARD_ID_PATTERN', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('draws at least 16 bytes (128 bits) from the cryptographic random source', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const id = newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as Uint8Array;
    expect(arg.byteLength).toBe(BOARD_ID_BYTES);
    // The code is exactly those random bytes, base64url-encoded (nothing derived from time or counters).
    expect(decodeBase64url(id)).toEqual(new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength));
  });

  it('uses only characters chat apps keep intact (letters, digits, - and _)', () => {
    for (let i = 0; i < 1000; i++) expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('named settings exist', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
