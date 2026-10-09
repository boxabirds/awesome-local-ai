import { afterEach, describe, expect, test, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

// share.unguessable: the link code is the board id. Every board's link must
// carry at least 128 bits of cryptographic randomness, be 22 characters of
// chat-safe base64url, and never repeat across 10,000 boards.
describe('share.board_api link code (TC-04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('TC-04 10,000 newBoardId() codes are unique, 22 chars, matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  test('TC-04 codes come from a cryptographic random source of at least 16 bytes', () => {
    const calls: number[] = [];
    const real = globalThis.crypto;
    vi.stubGlobal(
      'crypto',
      new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'getRandomValues') {
            return ((array: Uint8Array): Uint8Array => {
              calls.push(array.length);
              return real.getRandomValues(array as unknown as Uint8Array<ArrayBuffer>) as unknown as Uint8Array;
            }) as unknown as typeof real.getRandomValues;
          }
          return Reflect.get(target, prop, receiver);
        }
      })
    );
    const id = newBoardId();
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(calls.length).toBeGreaterThan(0);
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(16);
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
  });

  test('TC-04 codes are never derived from creation order: consecutive ids are unrelated', () => {
    let previous = newBoardId();
    for (let i = 0; i < 100; i += 1) {
      const next = newBoardId();
      // A code derived from order/time would share a long prefix or be a
      // small edit away; independent 128-bit draws share ~0 of it.
      let common = 0;
      while (common < previous.length && previous[common] === next[common]) common += 1;
      expect(common).toBeLessThan(6);
      previous = next;
    }
  });
});

describe('share named settings', () => {
  test('PRD share.create and share.copy durations are the named values', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
