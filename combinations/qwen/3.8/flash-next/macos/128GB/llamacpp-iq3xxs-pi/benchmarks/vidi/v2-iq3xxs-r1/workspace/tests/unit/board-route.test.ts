import { describe, expect, it } from 'vitest';
import { BOARD_PATH_PREFIX, boardIdFromPath, resolveBoardId } from '../../src/client/board/boardRoute';
import { newBoardId } from '../../src/shared/board-id';

/**
 * TC-22 asserts the address in the browser; these assert the rule behind it,
 * including the malformed cases that must not be joined as an id (the same rule
 * the Worker applies to `/api/rooms/:boardId`, so a URL is never a room the app
 * cannot also reach over the socket).
 */
describe('board URL (TC-22)', () => {
  it('reads the id from a board URL and nothing else', () => {
    const boardId = newBoardId();
    expect(boardIdFromPath(`${BOARD_PATH_PREFIX}${boardId}`)).toBe(boardId);
    // A trailing slash is the same board, not a deeper path.
    expect(boardIdFromPath(`${BOARD_PATH_PREFIX}${boardId}/`)).toBe(boardId);
    expect(boardIdFromPath('/')).toBeNull();
    expect(boardIdFromPath('/b/')).toBeNull();
    expect(boardIdFromPath('/b/short')).toBeNull();
    expect(boardIdFromPath('/settings')).toBeNull();
    // Never two segments: only one board at a time.
    expect(boardIdFromPath(`/b/${boardId}/extra`)).toBeNull();
  });

  it('keeps a valid board URL and replaces anything else', () => {
    const boardId = newBoardId();
    expect(resolveBoardId(`${BOARD_PATH_PREFIX}${boardId}`, 'generated')).toEqual({
      boardId,
      path: `${BOARD_PATH_PREFIX}${boardId}`,
    });
    for (const path of ['/', '/b/', '/b/short', '/b/UPPER_case-but-too_short', '/whatever']) {
      expect(resolveBoardId(path, 'generated')).toEqual({
        boardId: 'generated',
        path: `${BOARD_PATH_PREFIX}generated`,
      });
    }
  });

  it('generates a fresh unguessable id when the URL has no board', () => {
    const { boardId, path } = resolveBoardId('/');
    expect(boardId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(path).toBe(`${BOARD_PATH_PREFIX}${boardId}`);
    expect(newBoardId()).not.toBe(boardId);
  });
});
