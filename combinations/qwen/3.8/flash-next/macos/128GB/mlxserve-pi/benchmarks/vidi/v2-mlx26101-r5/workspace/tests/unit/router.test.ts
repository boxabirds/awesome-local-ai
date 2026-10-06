/**
 * Which page an address is — the whole routing table, as a function.
 *
 * Story 3 asked a different question here ("which board does this address want, and if none,
 * give me one"), so the tests that used to live beside these asserted that an unrecognised
 * address got a board. It does not any more, which is the point of story 5, and these assert
 * the new rule instead: an address that is not one of ours is answered as a link that leads
 * nowhere, and nothing about it is guessed at.
 *
 * The interesting cases are the ones a person arrives at by accident — a link truncated by a
 * chat application, an id with one character changed, a path from somewhere else entirely — and
 * what matters about each is not only that it is `notFound` but *what it reports back*: the page
 * shows the asked-for link so it can be compared with the one that was sent.
 */

import { describe, expect, it } from 'vitest';

import { boardPath, routeFor } from '../../src/client/router';
import { newBoardId } from '../../src/shared/board-id';

describe('the home page', () => {
  it('is /', () => {
    expect(routeFor('/')).toEqual({ kind: 'home' });
  });

  it('is what an empty path means too', () => {
    expect(routeFor('')).toEqual({ kind: 'home' });
  });

  it('does not take a board id with it any more', () => {
    // Story 3 made up a board here. The home page is a page now: it asks for a board when the
    // person presses the button, and until then nothing has been created and nothing has been
    // written into the address bar.
    const home = routeFor('/');
    expect(home.kind).toBe('home');
    expect('boardId' in home ? home.boardId : null).toBeNull();
  });
});

describe('a board link', () => {
  it('is /b/<board id>', () => {
    const boardId = newBoardId();
    expect(routeFor(boardPath(boardId))).toEqual({ kind: 'board', boardId });
  });

  it('survives a query string, because chat applications add them', () => {
    const boardId = newBoardId();
    expect(routeFor(`/b/${boardId}?utm_source=chat`)).toEqual({ kind: 'board', boardId });
  });

  it('accepts every character a board id is allowed to use', () => {
    // Sixty-two alphabet characters plus '-' and '_', in 22 draws: a link is any of them, and
    // the router has to know all of them rather than a subset it happens to recognise.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const character of alphabet) {
      const boardId = character.repeat(22);
      expect(routeFor(boardPath(boardId))).toEqual({ kind: 'board', boardId });
    }
  });

  it('comes back out of boardPath, which is what a copied link is made of', () => {
    const boardId = newBoardId();
    expect(routeFor(boardPath(boardId))).toEqual({ kind: 'board', boardId });
    expect(boardPath(boardId)).toBe(`/b/${boardId}`);
  });

  it('is percent-decoded, because a browser may hand us the encoded form', () => {
    const boardId = newBoardId();
    // Every character escaped, which is what some environments do to a link: the id is still
    // this id once the encoding is taken off, and it is the id the request has to be made for.
    const escaped = [...boardId]
      .map((character) => `%${character.charCodeAt(0).toString(16)}`)
      .join('');
    expect(routeFor(`/b/${escaped}`)).toEqual({ kind: 'board', boardId });
  });
});

describe('a link that leads nowhere', () => {
  it('is a /b/ with nothing after it', () => {
    expect(routeFor('/b/')).toEqual({ kind: 'notFound', boardId: null });
  });

  it('is an id that is too short, and reports what was asked for', () => {
    // The asked-for text comes back because the page shows it: a person comparing this with the
    // link in their chat window is looking for the two characters that are missing.
    expect(routeFor('/b/nope')).toEqual({ kind: 'notFound', boardId: 'nope' });
    expect(routeFor('/b/short')).toEqual({ kind: 'notFound', boardId: 'short' });
  });

  it('is an id with one character too many, which is what a truncated link looks like from the other side', () => {
    const oneTooLong = `${newBoardId()}x`;
    expect(routeFor(boardPath(oneTooLong))).toEqual({ kind: 'notFound', boardId: oneTooLong });
  });

  it('is an id with a character that is not in the alphabet', () => {
    const boardId = newBoardId();
    const broken = `${boardId.slice(0, 10)}+${boardId.slice(11)}`;
    expect(routeFor(boardPath(broken))).toEqual({ kind: 'notFound', boardId: broken });
    expect(routeFor('/b/has spaces')).toEqual({ kind: 'notFound', boardId: 'has spaces' });
  });

  it('is a board id with anything else after it', () => {
    // There is no page below a board, so there is no board here either. The whole tail is
    // reported: that is the link that was asked for.
    const boardId = newBoardId();
    expect(routeFor(`${boardPath(boardId)}/edit`)).toEqual({
      kind: 'notFound',
      boardId: `${boardId}/edit`,
    });
  });

  it('is an address from somewhere else, and does not pretend to know it', () => {
    for (const pathname of ['/pricing', '/b', '/B/', '/boards', '/api/boards', '//']) {
      expect(routeFor(pathname)).toEqual({ kind: 'notFound', boardId: null });
    }
  });

  it('is a path that tries to climb out', () => {
    for (const pathname of ['/b/../etc/passwd', '/b/%2e%2e/etc/passwd', '/b/..%2f..']) {
      const route = routeFor(pathname);
      expect(route.kind).toBe('notFound');
    }
  });

  it('is a percent-encoding no browser would accept, and does not throw on it', () => {
    // A broken escape is a broken link, not a crashed page: the page that says "no board" has to
    // be reachable by the worst address in the world.
    expect(routeFor('/b/%E0%A4%A')).toEqual({ kind: 'notFound', boardId: '%E0%A4%A' });
  });

  it('never reports a board id that the board id rules would reject', () => {
    // The one rule a caller can rely on without checking: if the router says `board`, that
    // string is a board id, and the page can put it in a request without looking at it.
    const addresses = ['/', '', '/b', '/b/', '/b/x', `/b/${newBoardId()}`, '/b/%zz', '/pricing'];
    for (const pathname of addresses) {
      const route = routeFor(pathname);
      if (route.kind === 'board') expect(route.boardId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
});
