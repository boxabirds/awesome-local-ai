import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import { boardIdForPath, boardIdFromPath, boardPath, roomPath } from '../../src/shared/routes';

/**
 * Story 3, sync.worker_entry: a board address is 16 random bytes written as
 * unpadded base64url, and it is the only thing that guards a board (there is
 * no sign-in until story 14), so the shape is checked before a Durable Object
 * is even looked up.
 */

/** base64url alphabet used to build well-formed ids of an arbitrary length. */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const ofLength = (n: number): string =>
  Array.from({ length: n }, (_, i) => B64URL[(i * 7) % B64URL.length]).join('');

/** Exactly 22 characters whose first character is `bad` (outside the alphabet). */
const withBadChar = (bad: string): string => bad + 'A'.repeat(21);

describe('isValidBoardId (boundary + negative)', () => {
  // TC-01: the only accepted shape is 22 base64url characters.
  it('TC-01 accepts a 22-character base64url id', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(isValidBoardId(ofLength(22))).toBe(true);
    // The two non-alphanumeric base64url characters are legal.
    expect(isValidBoardId('-_'.repeat(11))).toBe(true);
    expect(BOARD_ID_PATTERN.test(newBoardId())).toBe(true);
  });

  it('TC-01 rejects 21 and 23 characters (length boundaries)', () => {
    expect(isValidBoardId(ofLength(21))).toBe(false);
    expect(isValidBoardId(ofLength(23))).toBe(false);
  });

  it('TC-01 rejects characters outside the base64url alphabet', () => {
    expect(isValidBoardId(withBadChar('+'))).toBe(false);
    expect(isValidBoardId(withBadChar('='))).toBe(false);
    expect(isValidBoardId(withBadChar('.'))).toBe(false);
  });

  it('TC-01 rejects path traversal and the empty string', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (generation)', () => {
  // TC-02: 10 000 ids are all well-formed and all distinct.
  it('TC-02 generates 10000 ids that all match the pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});

// Story 3 adds the other half of the address: which board a browser asking for
// a page is on. The id in `/b/<id>` is the whole of what a board is, so an
// address that names no board is not an error — it becomes a new board, whose
// address then goes in the bar to be shared.
describe('boardIdForPath (which board an address names)', () => {
  const made = () => 'made-by-the-test-a-new-board';

  it('TC-01 takes the id out of the board address unchanged', () => {
    const id = 'p1Chvj4mAlXsf8Ue0YUGHw';
    expect(boardIdFromPath(`/b/${id}`)).toBe(id);
    expect(boardIdForPath(`/b/${id}`, made)).toBe(id);
  });

  it('TC-01 makes a new board for the root, so there is always a board to be on', () => {
    expect(boardIdFromPath('/')).toBeNull();
    expect(boardIdForPath('/', made)).toBe('made-by-the-test-a-new-board');
  });

  it('TC-01 names no board for an address that is not a board address', () => {
    for (const path of ['/b/', '/b', '/b/', '/b/../x', '/b/short', '/api/rooms/x', '/', '/b/x/y']) {
      expect(boardIdFromPath(path), path).toBeNull();
    }
  });

  it('TC-01 makes a well-formed id when the address names none', () => {
    expect(boardIdForPath('/')).toMatch(BOARD_ID_PATTERN);
    expect(boardIdForPath('/b/../x')).toMatch(BOARD_ID_PATTERN);
  });

  it('TC-02 gives a different board every time nobody named one', () => {
    const boards = new Set<string>();
    for (let index = 0; index < 100; index++) boards.add(boardIdForPath('/'));
    expect(boards.size).toBe(100);
  });

  it('keeps one board to its own address, and its socket to the same id', () => {
    const id = 'p1Chvj4mAlXsf8Ue0YUGHw';
    expect(boardPath(id)).toBe(`/b/${id}`);
    expect(roomPath(id)).toBe(`/api/rooms/${id}`);
    // the id is not re-encoded, re-cased or truncated on the way
    expect(boardIdFromPath(boardPath(id))).toBe(id);
  });
});
