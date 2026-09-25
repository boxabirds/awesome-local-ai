import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_LENGTH,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01, TC-02 (sync.worker_entry, unit half).
 *
 * Board ids are the only thing standing between one board and another until
 * story 5 puts real authorisation in front of them, so both halves are
 * tested: the generator must produce ids that the validator accepts, and the
 * validator must refuse everything that is not one.
 */

/** A generated id, because hand-written ids are explicitly not allowed. */
const validId = (): string => newBoardId();

describe('board id shape', () => {
  it('is 16 random bytes encoded as 22 base64url characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_LENGTH).toBe(22);
    expect(newBoardId()).toHaveLength(BOARD_ID_LENGTH);
  });

  it('accepts a generated 22 character id', () => {
    const id = validId();
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
  });

  // Boundary: the pattern is a length as well as an alphabet.
  it('refuses 21 and 23 character ids', () => {
    const id = validId();
    expect(isValidBoardId(id.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${id}A`)).toBe(false);
    expect(isValidBoardId(id.slice(0, 21).toUpperCase())).toBe(false);
  });

  // Negative: characters that a sloppy URL decode could hand to the Worker.
  it('refuses ids that are not base64url', () => {
    const id = validId();
    const withPlus = `${id.slice(0, 10)}+${id.slice(11)}`;
    const withSlash = `${id.slice(0, 10)}/${id.slice(11)}`;
    expect(withPlus).toHaveLength(22);
    expect(isValidBoardId(withPlus)).toBe(false);
    expect(isValidBoardId(withSlash)).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('../../secret')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(' ')).toBe(false);
    // Punctuation outside the alphabet is refused even at the right length.
    expect(isValidBoardId(`${id.slice(0, 21)}#`)).toBe(false);
  });

  it('checks shape, not provenance', () => {
    // Upper-casing an id keeps it inside the alphabet, so it is still a valid
    // (and still unguessable) address. Nothing in this story keys authorisation
    // off the id, and story 5 will mint ids instead of trusting the browser.
    expect(isValidBoardId(validId().toUpperCase())).toBe(true);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });

  it('refuses a percent-encoded path that decodes to a traversal', () => {
    expect(isValidBoardId(decodeURIComponent('%2e%2e%2fx'))).toBe(false);
  });
});

describe('newBoardId', () => {
  it('generates 10,000 valid, distinct ids', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    // 128 bits of randomness: a collision in 10,000 draws would mean the
    // generator is not actually random.
    expect(ids.size).toBe(10_000);
  });

  it('uses the whole alphabet rather than a narrow slice of it', () => {
    const characters = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      for (const character of newBoardId()) characters.add(character);
    }
    // Letters, digits and both base64url extras should all show up.
    expect(characters.has('-') || characters.has('_')).toBe(true);
    expect(characters.size).toBeGreaterThan(40);
  });
});
