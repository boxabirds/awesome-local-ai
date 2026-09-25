/**
 * The router (story 5, task 4).
 *
 * `resolveRoute` is the only place that decides which page a pathname gets, and
 * it decides three ways: home, a named board, or "Board not found". Everything
 * else in the client reads its answer, so the two things worth pinning are the
 * ones a person can actually produce: a link that lost characters in a chat
 * app, and an address that was never a board at all.
 *
 * The generated paths are there for the same reason: a hand-written list of
 * examples stops at the ones someone thought of, and the shape that matters is
 * "22 characters is a board, 21 or 23 is not".
 */
import { describe, expect, it } from 'vitest';
import { BOARD_ID_LENGTH, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { boardIdInPath, isBrokenBoardLink, resolveRoute } from '../../src/client/router';

/** A valid id, from the real generator rather than a typed fixture. */
const ID = newBoardId();

describe('resolveRoute names at most one board', () => {
  it('sends the bare origin and the home path to the home page', () => {
    for (const path of ['', '/']) {
      expect(resolveRoute(path)).toEqual({ page: 'home' });
    }
  });

  it('reads a board from the share prefix and from the legacy one', () => {
    // Both prefixes have to work: `/board/…` is what stories 3 and 4 put in
    // people's bookmarks, `/b/…` is what Share copies now.
    expect(resolveRoute(`/b/${ID}`)).toEqual({ page: 'board', boardId: ID });
    expect(resolveRoute(`/board/${ID}`)).toEqual({ page: 'board', boardId: ID });
  });

  it('drops a query and a fragment before testing the shape', () => {
    // A chat app appends `?utm_…`; a pasted link often still has `#xyz`.
    expect(resolveRoute(`/b/${ID}?utm_source=chat`).page).toBe('board');
    expect(resolveRoute(`/b/${ID}#note-3`).page).toBe('board');
    expect(boardIdInPath(`/b/${ID}?x=1`)).toBe(ID);
  });

  it('treats a truncated or padded id as no board at all', () => {
    // 21 characters is a link that lost one, and 23 is a link that gained one.
    const short = ID.slice(0, BOARD_ID_LENGTH - 1);
    expect(resolveRoute(`/b/${short}`).page).toBe('not_found');
    expect(resolveRoute(`/b/${ID}x`).page).toBe('not_found');
    expect(resolveRoute('/b/abc').page).toBe('not_found');
    expect(resolveRoute('/b/')).toEqual({ page: 'not_found', attempted: '/b/' });
  });

  it('refuses a path that only looks like a board', () => {
    // `/b` on its own, an extra segment, and a decoded slash: none of them may
    // reach a room, because a wrong room is a second board that looks like yours.
    expect(resolveRoute('/b').page).toBe('not_found');
    expect(resolveRoute(`/b/${ID}/extra`).page).toBe('not_found');
    expect(resolveRoute(`/b/${ID}%2Fextra`).page).toBe('not_found');
    expect(resolveRoute('/settings').page).toBe('not_found');
    expect(resolveRoute('/BOARD/anything').page).toBe('not_found');
  });
});

describe('boardIdInPath only answers for a whole id', () => {
  it('accepts nothing that fails the shape test, however it is spelled', () => {
    const hostile = [
      '/b/%2e%2e%2f%2e%2e%2fetc', // encoded traversal
      `/b/${ID.slice(0, 21)}`, // one short
      `/b/${ID}xy`, // one long
      `/b/${ID.slice(0, 21)} `, // a trailing space, from a hand-typed paste
      '/b//',
    ];
    for (const path of hostile) {
      expect(boardIdInPath(path)).toBeNull();
    }
  });

  it('accepts every generated id, at either prefix', () => {
    for (let index = 0; index < 200; index += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(boardIdInPath(`/b/${id}`)).toBe(id);
      expect(boardIdInPath(`/board/${id}`)).toBe(id);
    }
  });
});

describe('isBrokenBoardLink marks only real link attempts', () => {
  it('is quiet about the ordinary paths', () => {
    // Warning at `/` would be noise; warning at `/settings` has nothing to do
    // with a board link.
    expect(isBrokenBoardLink('/')).toBe(false);
    expect(isBrokenBoardLink('/settings')).toBe(false);
  });

  it('calls out a truncated link under either prefix', () => {
    expect(isBrokenBoardLink(`/b/${ID.slice(0, 12)}`)).toBe(true);
    expect(isBrokenBoardLink(`/board/${ID.slice(0, 12)}`)).toBe(true);
    expect(isBrokenBoardLink(`/b/${ID}`)).toBe(false);
    expect(isBrokenBoardLink(`/board/${ID}`)).toBe(false);
  });
});
