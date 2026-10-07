import { describe, expect, it } from 'vitest';
import { BOARD_PATH_PREFIX, boardPath, routeFromPath } from '../../src/client/router';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

/**
 * TC-22 asserts the address in the browser; these assert the rule behind it. Story 3
 * wrote the rule as "give me a board id, or make one" (`resolveBoardId`), which is the
 * behaviour story 5 removes: an address that names no board is not a board, and only
 * the server knows whether it names one. So the router's job stops at *shape*, and
 * `isValidBoardId` — the same test the Worker applies to `/api/boards/:boardId` —
 * decides whether the shape can name one at all.
 */
describe('board URL (TC-22)', () => {
  it('reads the id from a board URL', () => {
    const boardId = newBoardId();
    expect(routeFromPath(`${BOARD_PATH_PREFIX}${boardId}`)).toEqual({ name: 'board', id: boardId });
    // A trailing slash is the same board, not a deeper path.
    expect(routeFromPath(`${BOARD_PATH_PREFIX}${boardId}/`)).toEqual({ name: 'board', id: boardId });
    // The address a board page writes for itself is one the router reads back.
    expect(routeFromPath(boardPath(boardId))).toEqual({ name: 'board', id: boardId });
  });

  it('knows the home page and everything else', () => {
    expect(routeFromPath('/')).toEqual({ name: 'home' });
    expect(routeFromPath('')).toEqual({ name: 'home' });
    expect(routeFromPath('/settings')).toEqual({ name: 'not_found' });
    expect(routeFromPath('/b')).toEqual({ name: 'not_found' });
    expect(routeFromPath('/b/')).toEqual({ name: 'not_found' });
    // Never two segments: only one board at a time.
    expect(routeFromPath(`/b/${newBoardId()}/extra`)).toEqual({ name: 'not_found' });
  });

  it('hands on an id whose shape cannot name a board, and does not invent one', () => {
    // These are board *addresses* that name no board: the page reports them as not
    // found without asking the server, because the server would refuse them too.
    const malformed = [
      '/b/short',
      '/b/UPPER_case-but-too_short',
      `/b/${'a'.repeat(23)}`, // 22 characters is the whole address; 23 is not an id
      `/b/${'a'.repeat(21)}`,
      '/b/not-base64url!',
    ];
    for (const path of malformed) {
      const route = routeFromPath(path);
      expect(route.name, path).toBe('board');
      if (route.name === 'board') {
        expect(isValidBoardId(route.id), `${path} -> ${route.id}`).toBe(false);
      }
    }
    // And nothing here invented an id: story 3's `/` → random-board case is gone, and
    // only the server makes a board (TC-01, TC-05).
    expect(routeFromPath('/')).not.toHaveProperty('id');
  });
});
