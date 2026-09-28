// Which address asks for what. This is where a link that cannot be a code is
// answered - as a page, without a request - and where a code keeps the address it
// was shared with.
import { describe, it, expect } from 'vitest';
import { boardPath, parseRoute } from '../../src/client/router.ts';
import { routeKey } from '../../src/client/useRoute.ts';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id.ts';
import { randomBytes } from 'node:crypto';

const code = newBoardId();

describe('the address of a board', () => {
  it('TC-16: the address of a board is its own, and it is the one that gets shared', () => {
    expect(boardPath(code)).toBe(`/b/${code}`);
    // The pattern accepts it: the address the panel offers is an address the app
    // would open as a board, which is what a link has to be.
    expect(BOARD_ID_PATTERN.test(code)).toBe(true);
    // The address is a board path built from the code, and nothing else.
    expect(boardPath(code).slice('/b/'.length)).toBe(code);
  });

  it('TC-25: what is not a board is answered as its own page', () => {
    // A wrong length, a wrong character, no code at all, and an unrelated path.
    expect(parseRoute('/b/short')).toEqual({ kind: 'not_found', boardId: 'short' });
    expect(parseRoute(`/b/${'a'.repeat(64)}`)).toEqual({
      kind: 'not_found',
      boardId: 'a'.repeat(64),
    });
    expect(parseRoute('/b/nope_nope_nope')).toEqual({
      kind: 'not_found',
      boardId: 'nope_nope_nope',
    });
    expect(parseRoute('/b/')).toEqual({ kind: 'not_found', boardId: null });
    expect(parseRoute('/b')).toEqual({ kind: 'not_found', boardId: null });
    expect(parseRoute('/settings/board')).toEqual({ kind: 'not_found', boardId: null });
    expect(parseRoute('/api/boards')).toEqual({ kind: 'not_found', boardId: null });
  });

  it('a code is a board and the start page is the start page', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute(`/b/${code}`)).toEqual({ kind: 'board', boardId: code });
    // A code with something after it is still that board: the code ends where the
    // code ends.
    expect(parseRoute(`/b/${code}/`)).toEqual({ kind: 'board', boardId: code });
  });

  it('a code is only as long as a code is: what follows is not part of it', () => {
    // Anything the id pattern accepts comes from 16 bytes, so an id of a different
    // length is not a code that was shortened - it is not a code.
    expect(BOARD_ID_PATTERN.test(randomBytes(8).toString('base64url'))).toBe(false);
    expect(BOARD_ID_PATTERN.test(randomBytes(24).toString('base64url'))).toBe(false);
  });

  it('a different code is a different page', () => {
    const other = newBoardId();
    expect(routeKey({ kind: 'home' })).toBe('home');
    expect(routeKey({ kind: 'board', boardId: code })).toBe(`board:${code}`);
    expect(routeKey({ kind: 'board', boardId: other })).toBe(`board:${other}`);
    expect(routeKey({ kind: 'board', boardId: code })).not.toBe(routeKey({ kind: 'board', boardId: other }));
    expect(routeKey({ kind: 'not_found', boardId: code })).toBe(`not_found:${code}`);
  });
});
