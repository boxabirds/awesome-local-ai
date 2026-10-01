import { describe, expect, it } from 'vitest';
import { routeFor } from '../../src/client/router';
import { newBoardId } from '../../src/shared/board-id';

/**
 * Story 5, client.story5_share_link: which page an address names. This is the
 * pure half of the router — the half that needs no DOM — so every route shape,
 * including the malformed-address branch that must resolve to `not_found` without
 * the client ever sending a request, is checked here as well as rendered in
 * `tests/ui/router.test.tsx` (TC-19).
 */
describe('routeFor (TC-19: which page an address names)', () => {
  it('takes the root as home', () => {
    expect(routeFor('/')).toEqual({ name: 'home' });
  });

  it('takes a board address as that board, id taken unchanged', () => {
    const id = newBoardId();
    expect(routeFor(`/b/${id}`)).toEqual({ name: 'board', id });
  });

  it('takes anything that is not a board address as not-found', () => {
    for (const path of [
      '/b/', // an empty id
      '/b', // not under /b/
      '/b/short', // too short to be an id
      '/b/../x', // traversal
      '/b/x/y', // trailing segments
      '/made/up/thing', // not a board address at all
      '/b/Zm9v', // well-formed alphabet, but too short to be an id
    ]) {
      expect(routeFor(path), path).toEqual({ name: 'not_found' });
    }
  });

  it('names a board for a full-length well-formed code (the page then asks the server)', () => {
    // Deciding existence is the BoardPage's job, not the router's: a full-length
    // well-formed code names a board route even if no such board exists.
    expect(routeFor(`/b/${newBoardId()}`).name).toBe('board');
  });

  it('never mistakes the board API or room API for a page route', () => {
    expect(routeFor('/api/boards')).toEqual({ name: 'not_found' });
    expect(routeFor(`/api/rooms/${newBoardId()}`)).toEqual({ name: 'not_found' });
  });
});
