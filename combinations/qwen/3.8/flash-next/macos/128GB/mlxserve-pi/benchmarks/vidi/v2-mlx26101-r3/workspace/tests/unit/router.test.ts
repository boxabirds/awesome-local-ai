import { describe, expect, it } from 'vitest';
import { BOARD_PATH, HOME_PATH, boardPath, routeOf } from '../../src/client/router';
import { newBoardId } from '../../src/shared/board-id';

/**
 * TC-20 (`share.client_router`): the address bar read as one of three things.
 *
 * The route is the only part of this app that arrives from outside - somebody typed it, or
 * somebody pasted a link with one character wrong - so what is tested here is the reading of it,
 * which is pure and does not need a browser: which addresses are the home page, which are a board
 * and which are nothing, and what a board's address looks like when it is written down rather than
 * read.
 */

describe('routeOf', () => {
  it('knows the home page by its address, and only by that', () => {
    for (const path of ['/', '', '/index.html']) {
      expect(routeOf(path)).toEqual({ kind: 'home' });
    }
    // `/b` on its own is not a board with an empty name, and `/b/` is not either.
    expect(routeOf('/b').kind).toBe('not-found');
    expect(routeOf('/b/').kind).toBe('not-found');
  });

  it('reads a board address into the board it names', () => {
    const id = newBoardId();
    expect(routeOf(`/b/${id}`)).toEqual({ kind: 'board', boardId: id });
    // A trailing slash is the same address: browsers put them on, and links arrive with them.
    expect(routeOf(`/b/${id}/`)).toEqual({ kind: 'board', boardId: id });
    // The characters a board id is allowed to have - including `-` and `_` - in an address.
    const odd = 'Ab_-9_zYxWvUtSrQpOnM01';
    expect(routeOf(`/b/${odd}`)).toEqual({ kind: 'board', boardId: odd });
  });

  it('says "not a board" about an address that cannot name one', () => {
    for (const path of [
      '/b/abc',
      '/b/not-a-board-id',
      '/b/%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20',
      '/b/has%20space',
      '/b/nope!',
      '/b/',
      '/b',
      '/boards/abc',
      '/b/too/many/segments',
      '/anything/else',
    ]) {
      expect(routeOf(path).kind, path).toBe('not-found');
    }
  });

  it('draws the line at the length a board id is, in both directions', () => {
    // 22 characters is what the generator produces; 21 and 23 are not a board's code, however
    // close they look to one, and a page must not go looking for a board that cannot exist.
    expect(routeOf(`/b/${'A'.repeat(21)}`).kind).toBe('not-found');
    expect(routeOf(`/b/${'A'.repeat(22)}`).kind).toBe('board');
    expect(routeOf(`/b/${'A'.repeat(23)}`).kind).toBe('not-found');
  });

  it('gives up on an address that is not even a possible escape', () => {
    // `%` used for something other than an escape sequence: not a board, and not a crash either.
    expect(routeOf('/b/%').kind).toBe('not-found');
    expect(routeOf('/b/%zz%zz%zz%zz%zz%zz%zz').kind).toBe('not-found');
  });

  it('is the exact inverse of writing a board address down, for every character a name may hold', () => {
    const id = newBoardId();
    expect(routeOf(boardPath(id))).toEqual({ kind: 'board', boardId: id });
    // And the address that gets written down is the one the Worker's own route answers.
    expect(boardPath(id)).toMatch(BOARD_PATH);
    expect(boardPath(id).startsWith(HOME_PATH)).toBe(true);
    expect(boardPath(id)).toBe(`/b/${id}`);
  });
});
