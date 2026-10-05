/**
 * The link code of a board (story 5, share.unguessable / TC-04).
 *
 * A board link is the whole of its access control: there is no sign-in and no
 * permission, so the only thing standing between a stranger and somebody's board is
 * the size and the randomness of the code in the address. That claim is testable in
 * exactly three parts, and this file is all three:
 *
 *  - a code is as long and as regular as the design says (22 characters of base64url,
 *    so it survives a chat app and a chat app's link previewer unchanged);
 *  - ten thousand of them are all different, which is what "you will not bump into
 *    somebody else's board" means in practice;
 *  - and, the part a uniqueness test cannot show, the code is *only* the random bytes:
 *    nothing about when the board was made, what order it was made in, or any other
 *    board is written into it. A code that was a counter dressed up as base64url would
 *    pass the uniqueness test and fail this one.
 *
 * The random source is `crypto.getRandomValues` — the platform's cryptographic one, in
 * the Worker as in the browser — and it is watched here rather than trusted: the test
 * records how many bytes were asked for, because "at least 128 bits" is a claim about
 * the number of bytes drawn, not about the string's length.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { BOARD_ID_BYTES, BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

/** How many codes "10,000 created boards have distinct codes" asks for. */
const SAMPLE = 10_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a board link code (TC-04)', () => {
  it('is 22 characters of link-safe text, every time', () => {
    for (let index = 0; index < 500; index += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
      // Only letters, digits, hyphen and underscore: nothing a chat app or an email
      // client can break, re-encode or decide is the end of a URL.
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(id).not.toContain('=');
      expect(id).not.toContain('/');
      expect(id).not.toContain('+');
    }
  });

  it('draws at least 16 cryptographic random bytes per code', () => {
    const drawn: number[] = [];
    const real = crypto.getRandomValues.bind(crypto);
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView>(values: T): T => {
      drawn.push(values.byteLength);
      return real(values);
    });

    const codes = 200;
    for (let index = 0; index < codes; index += 1) newBoardId();

    expect(spy).toHaveBeenCalledTimes(codes);
    // One draw per code, and every draw at least 128 bits of it.
    expect(drawn).toHaveLength(codes);
    for (const bytes of drawn) expect(bytes).toBeGreaterThanOrEqual(16);
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('gives every one of 10,000 boards its own code', () => {
    const codes = new Set<string>();
    for (let index = 0; index < SAMPLE; index += 1) codes.add(newBoardId());
    expect(codes.size).toBe(SAMPLE);
  });

  it('is nothing but its random bytes, so no order, time or other board is in it', () => {
    // The bytes are fixed, so the code has to be their base64url and nothing else: no
    // timestamp, no counter, no piece of a previous code. This is the assertion that
    // fails for a code generated any other way, which is the point of the exercise.
    const bytes = new Uint8Array(BOARD_ID_BYTES).fill(0);
    const stub = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView>(values: T): T => {
      const view = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      view.set(bytes);
      return values;
    });

    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const first = newBoardId();
    expect(first).toBe('A'.repeat(22));

    // The same bytes give the same code whatever the clock says, and whatever code was
    // issued before it: a code is a name, not a number in disguise.
    clock.mockReturnValue(1_700_000_000_001);
    bytes[15] = 1;
    const second = newBoardId();
    expect(second).toBe(`${'A'.repeat(20)}AQ`);
    expect(second).not.toBe(first);

    // One bit at the top of the first byte moves the first character and nothing else,
    // and one bit at the bottom of the last byte moves the last one. Both are only true
    // of a code that is the bytes themselves: a code that hashed or truncated them would
    // move characters it has no business moving, and a code that mixed a counter in would
    // move characters no byte of this input explains.
    bytes[15] = 0;
    bytes[0] = 128;
    expect(newBoardId()).toBe(`g${'A'.repeat(21)}`);

    bytes[0] = 0;
    bytes.fill(255);
    // The last character of a 16-byte code carries the two bottom bits of the last byte
    // and four zero bits of padding, which is the one place where the code is not a
    // straight copy of the bytes — and so the one character a reader should expect to be
    // constrained (`_w`, ``g`…`: four possibilities, never 64).
    expect(newBoardId()).toBe(`${'_'.repeat(21)}w`);

    expect(stub).toHaveBeenCalled();
    // And the clock was never read: a code cannot have a timestamp in it if nothing in
    // the making of it looks at the time. This is the assertion the two matching codes
    // above only hint at.
    expect(clock).not.toHaveBeenCalled();
  });

  it('uses the whole alphabet, so every character carries its full six bits', () => {
    // base64url packs six random bits into every character. Read five of them instead —
    // which is what an off-by-one mask does — and 22 characters are 110 bits, not the
    // 128 this product's whole security model is written to be. The alphabet is a plain
    // statement of that: 64 possible characters, and a code that can only ever spell 32
    // of them has lost a bit per character.
    const seen = new Set<string>();
    for (let index = 0; index < SAMPLE; index += 1) for (const char of newBoardId()) seen.add(char);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    expect(seen.size).toBe(64);
    expect([...seen].sort()).toEqual([...alphabet].sort());
  });

  it('does not repeat a code even when the same board id is asked for twice in a row', () => {
    // The negative of "a code is derived from its creation order": two codes made one
    // after the other, from the same code path, are unrelated.
    expect(newBoardId()).not.toBe(newBoardId());
  });
});

describe('the settings behind the link (story 5)', () => {
  it('are the numbers the PRD names', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
    // The check's backoff starts below the connection's ceiling, or "retrying" would
    // be a single wait with no doubling in it.
    expect(BOARD_CHECK_RETRY_BASE_MS).toBeLessThanOrEqual(10_000);
  });
});
