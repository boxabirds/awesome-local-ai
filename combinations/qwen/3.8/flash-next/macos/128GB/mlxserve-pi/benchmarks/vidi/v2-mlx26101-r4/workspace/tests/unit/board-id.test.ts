/**
 * Unit tests for board addresses (sync.worker_entry) and the story 3 settings.
 *
 * A board has no accounts and no membership list: the address is the whole of its
 * access control, so "is this string a board address" and "make a new one that
 * nobody else can have" are the two things worth pinning down before anything is
 * allowed to open a room for an address.
 */
import { describe, expect, it } from 'vitest';

import {
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  AWARENESS_TIMEOUT_MS,
  BOARD_ID_BYTES,
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
  RECONNECT_WAIT_MS,
} from '../../src/shared/config';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url address', () => {
    // 16 bytes of base64 without padding is 22 characters: the shape every board
    // has, and the only shape the Worker will start a room for.
    expect(BOARD_ID_BYTES).toBe(16);
    expect(isValidBoardId('abcdEFGH0123456789_-AB')).toBe(true);
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('refuses one character short and one character long (boundary)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
    expect('a'.repeat(22)).toMatch(BOARD_ID_PATTERN);
  });

  it('refuses characters that are base64 but not base64url, or not an address at all', () => {
    // '+' and '/' are base64 and '=' is its padding; none of them belongs in a URL
    // segment that is also a room name, so the pattern has to turn them away rather
    // than accept anything that "looks like base64".
    expect(isValidBoardId('abcdEFGH0123456789_+AB')).toBe(false);
    expect(isValidBoardId('abcdEFGH0123456789_=AB')).toBe(false);
    expect(isValidBoardId('abcdEFGH0123456789_/AB')).toBe(false);
    // The traversal attempt a path parameter always ends up receiving.
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('..%2f..%2fetc')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('board')).toBe(false);
    expect(isValidBoardId('abcdEFGH0123456789_-AB ')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('makes addresses that are exactly 22 characters of base64url', () => {
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('makes 10,000 addresses that are all well-formed and all different', () => {
    // Two boards must not end up with the same address, because an address is the
    // only permission there is. 10,000 draws are checked against the pattern and
    // against each other.
    const made = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      made.add(id);
    }
    expect(made.size).toBe(10_000);
  });
});

describe('story 3 settings', () => {
  it('states the numbers the rest of the story is written in terms of', () => {
    // The capacity the board is designed for is a design number, not a limit; the
    // latency budget is what a change is aimed to arrive inside; the backoff and the
    // confirmation are the two waits a person can actually notice.
    expect(MAX_CONCURRENT_EDITORS).toBe(5);
    expect(LIVE_UPDATE_LATENCY_BUDGET_MS).toBe(1000);
    expect(RECONNECT_MAX_BACKOFF_MS).toBe(10_000);
    expect(CONNECTED_CONFIRMATION_MS).toBe(2000);
    expect(CATCH_UP_TEST_OUTAGE_MS).toBe(30_000);
    // The waits a test is allowed to have: an update has to be quick, a reconnection
    // is allowed to take its time, and the whole exchange is given a window wider
    // than either of them.
    expect(E2E_EVENTUAL_TIMEOUT_MS).toBe(15_000);
    expect(RECONNECT_WAIT_MS).toBe(45_000);
    expect(AWARENESS_TIMEOUT_MS).toBe(30_000);
    // A room name is 128 bits of random, and so is one second of a peer's presence.
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
