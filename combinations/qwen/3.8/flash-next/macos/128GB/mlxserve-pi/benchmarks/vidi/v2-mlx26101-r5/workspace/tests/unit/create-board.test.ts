/**
 * TC-04: the link code is a link code.
 *
 * `share.unguessable` is a claim about a string — at least 128 bits of randomness, 22
 * characters, drawn from an alphabet chat and email applications do not re-encode — and about
 * a relationship: no board's link comes from its creation order, its clock, its creator or
 * another board's link. All of that is checkable without a Worker, a socket or a browser,
 * which is why it is checked here first, before anything else in the board API is built.
 *
 * The randomness is asserted rather than assumed: `crypto.getRandomValues` is watched, so the
 * suite knows how many bytes are asked for and from which source. A generator that quietly
 * fell back to a counter would still produce 22 characters and would pass a format test.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
  BOARD_CHECK_RETRY_BASE_MS,
} from '../../src/shared/config';

/** How many codes the PRD's verification asks for. */
const SAMPLE = 10_000;

describe('a board link cannot be guessed (TC-04)', () => {
  it('is 22 characters of the base64url alphabet, every time, for 10,000 boards', () => {
    const ids = new Set<string>();
    for (let index = 0; index < SAMPLE; index += 1) {
      const id = newBoardId();
      expect(id, 'a link is 22 characters').toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id), `a link is base64url: ${id}`).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
      // Nothing a chat application or an email client likes to chew on.
      expect(id).not.toMatch(/[+/=]/);
      ids.add(id);
    }
    expect(ids.size, '10,000 boards, 10,000 different links').toBe(SAMPLE);
  });

  it('draws 16 bytes — 128 bits — from the cryptographic random source every time', () => {
    const source = crypto.getRandomValues.bind(crypto);
    const asked: number[] = [];
    const spied = vi.fn((bytes: Uint8Array): Uint8Array => {
      asked.push(bytes.length);
      return source(bytes);
    });
    vi.stubGlobal('crypto', { ...crypto, getRandomValues: spied });
    try {
      expect(newBoardId()).toHaveLength(22);
      expect(newBoardId()).toHaveLength(22);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(BOARD_ID_BYTES).toBe(16);
    expect(asked).toEqual([BOARD_ID_BYTES, BOARD_ID_BYTES]);
  });

  it('asks the random source for fresh bytes each time, so no two calls share a value', () => {
    // A generator that filled one buffer once and shuffled it would be 22 characters long,
    // 10,000-of-10,000 unique for a while, and completely guessable. Each code has to be its
    // own draw.
    const drawn: Uint8Array[] = [];
    const spied = vi.fn((bytes: Uint8Array): Uint8Array => {
      const fill = new Uint8Array(bytes.length).fill(drawn.length);
      bytes.set(fill);
      drawn.push(bytes);
      return bytes;
    });
    vi.stubGlobal('crypto', { ...crypto, getRandomValues: spied });
    try {
      const first = newBoardId();
      const second = newBoardId();
      expect(first).not.toBe(second);
      expect(drawn).toHaveLength(2);
      expect(drawn[0]).not.toBe(drawn[1]);
      // And the values really are the bytes: base64url of what the source handed over.
      expect(second).toBe(base64url(new Uint8Array(BOARD_ID_BYTES).fill(1)));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is not derived from when, or from what came before', () => {
    // Two boards made one after the other share nothing but the alphabet: a code is not a
    // counter, not a timestamp, and not a prefix of the last one.
    const ids = Array.from({ length: 50 }, () => newBoardId());
    const time = String(Date.now());
    for (const id of ids) {
      expect(id).not.toContain(time);
      expect(id).not.toContain(String(Date.now()).slice(0, 8));
    }
    const sharedPrefix = ids.reduce(
      (longest, id) => Math.min(longest, commonPrefix(ids[0] as string, id)),
      Number.POSITIVE_INFINITY,
    );
    expect(sharedPrefix, 'a thousand links do not start the same way').toBeLessThan(4);
  });
});

describe('the settings behind the share experience are named', () => {
  it('carry the values the PRD asks for', () => {
    expect(CREATE_BUDGET_MS, 'PRD share.create: a board opens within 2 seconds').toBe(2000);
    expect(LINK_COPIED_MS, '"Link copied" stays for 2 seconds').toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS, 'the first wait before checking a link again').toBe(1000);
  });
});

/** How many characters two strings start with in common. */
function commonPrefix(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

/** The same encoding `newBoardId` uses: base64url, unpadded. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
