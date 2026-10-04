/**
 * share.board_api, unit: the link code itself (share.unguessable).
 *
 * A board's link is its only access control, so the code in it has to be a number
 * nobody can guess: 16 bytes (128 bits) from the platform's cryptographic random
 * source, base64url encoded into the 22 characters that chat and email apps do not
 * break, and never repeated. Nothing here is derived from time, order or another
 * board — the only way to predict one is to be given it.
 *
 * TC-04 10,000 fresh codes: all unique, all 22 characters, all matching
 * BOARD_ID_PATTERN, all the base64url of 16 random bytes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
} from '../../src/shared/config';

const RANDOM_IDS = 10_000;

/** base64url back to bytes, for the "it really is 16 random bytes" claim. */
function fromBase64Url(code: string): Uint8Array {
  const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('board link codes (TC-04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('produces 10,000 codes that are all unique, 22 characters and well formed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < RANDOM_IDS; i++) {
      const code = newBoardId();
      expect(code).toMatch(BOARD_ID_PATTERN);
      expect(code.length).toBe(22);
      expect(isValidBoardId(code)).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBe(RANDOM_IDS);
  });

  it('draws every code from 16 cryptographic random bytes (128 bits)', () => {
    const lengths: number[] = [];
    const getRandomValues = vi.fn((target: Uint8Array) => {
      lengths.push(target.byteLength);
      for (let i = 0; i < target.length; i++) target[i] = (i * 31 + 7) % 256;
      return target;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const code = newBoardId();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(lengths).toEqual([BOARD_ID_BYTES]);
    expect(fromBase64Url(code)).toEqual(new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 31 + 7) % 256)));
  });

  it('uses only characters chat and email apps leave alone', () => {
    // Letters, digits, hyphen and underscore: nothing that gets re-encoded, and
    // nothing (not even '/') that would end the path segment a link is made of.
    for (let i = 0; i < 500; i++) {
      expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('never derives a code from creation order (consecutive codes differ everywhere)', () => {
    // Two codes made back to back share nothing but their length: there is no
    // counter, timestamp or predecessor in them to grow a link from.
    const codes = Array.from({ length: 100 }, () => newBoardId());
    const prefixes = new Set(codes.map((code) => code.slice(0, 4)));
    expect(prefixes.size).toBeGreaterThan(90);
  });
});

describe('story 5 named settings', () => {
  it('matches the PRD numbers', () => {
    expect(CREATE_BUDGET_MS).toBe(2000); // share.create
    expect(LINK_COPIED_MS).toBe(2000); // share.copy
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000); // share.unreachable
    expect(BOARD_ID_BYTES).toBe(16); // share.unguessable: 128 bits
  });
});
