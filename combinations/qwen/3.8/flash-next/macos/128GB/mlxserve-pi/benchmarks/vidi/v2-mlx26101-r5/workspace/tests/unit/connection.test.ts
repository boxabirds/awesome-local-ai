/**
 * The pure half of live sync: which room a board id points at, which board an address is
 * asking for, and what the badge says in each state. No sockets and no timers here —
 * those are in `tests/component/ConnectionStatus.test.tsx`.
 */

import { describe, expect, it } from 'vitest';

import {
  connectionIsVisible,
  connectionLabel,
  roomUrl,
  serverUrl,
} from '../../src/client/board/connection';
import { boardPath, boardRoute } from '../../src/client/board/useBoardRoute';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('roomUrl — the address of a board room', () => {
  it('is the room path on the page’s own origin, with wss on https', () => {
    const boardId = newBoardId();
    expect(roomUrl(boardId, 'https://vidi6.app/some/page?x=1')).toBe(
      `wss://vidi6.app/api/rooms/${boardId}`,
    );
  });

  it('is ws on a plain-http origin, port included', () => {
    const boardId = newBoardId();
    expect(roomUrl(boardId, 'http://127.0.0.1:20784/')).toBe(
      `ws://127.0.0.1:20784/api/rooms/${boardId}`,
    );
  });

  it('leaves nothing but the room path behind', () => {
    // The Worker routes on the path alone; a query string or a fragment left over from
    // the page address would be a different room as far as anybody else is concerned.
    const boardId = newBoardId();
    const url = new URL(roomUrl(boardId, 'https://vidi6.app/b/other?share=1#note-3'));
    expect(url.pathname).toBe(`/api/rooms/${boardId}`);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('puts the board id last, which is what the Worker reads', () => {
    // `/api/rooms/:boardId` — the id has to be the final segment for the route to see it.
    const boardId = newBoardId();
    const segments = new URL(roomUrl(boardId, 'https://vidi6.app/')).pathname
      .split('/')
      .filter((segment) => segment !== '');
    expect(segments.at(-1)).toBe(boardId);
    expect(segments.slice(0, -1)).toEqual(['api', 'rooms']);
  });

  it('is built the way the provider builds it: the collection, then the room name', () => {
    // y-websocket is handed `/api/rooms` as its server and the board id as the room name,
    // and joins them with a '/'. Handing it the room address instead would dial the id
    // twice, and the Worker would read `<id>/<id>` as a board id and refuse it.
    const boardId = newBoardId();
    expect(serverUrl('https://vidi6.app/')).toBe('wss://vidi6.app/api/rooms');
    expect(roomUrl(boardId, 'https://vidi6.app/')).toBe(`${serverUrl('https://vidi6.app/')}/${boardId}`);
  });

  it('does not leave a slash for the provider to double up', () => {
    const boardId = newBoardId();
    for (const base of ['https://vidi6.app', 'https://vidi6.app/', 'https://vidi6.app/b/x?q=1']) {
      expect(serverUrl(base)).toBe('wss://vidi6.app/api/rooms');
      expect(roomUrl(boardId, base)).toBe(`wss://vidi6.app/api/rooms/${boardId}`);
    }
  });

  it('gives different boards different rooms', () => {
    const first = newBoardId();
    const second = newBoardId();
    expect(roomUrl(first, 'https://vidi6.app/')).not.toBe(roomUrl(second, 'https://vidi6.app/'));
  });
});

describe('boardRoute — the board an address asks for', () => {
  // A board id that is a legal one, so "the fresh id wins" can be asserted as a value.
  const fresh = 'freshfreshfreshfresh01';

  it('takes the board from /b/<id>', () => {
    const boardId = newBoardId();
    expect(boardRoute(`/b/${boardId}`, fresh)).toEqual({ kind: 'board', boardId });
  });

  it('sends a visitor at / to a board rather than an empty screen', () => {
    expect(boardRoute('/', fresh)).toEqual({ kind: 'board', boardId: fresh });
    expect(isValidBoardId((boardRoute('/', fresh) as { boardId: string }).boardId)).toBe(true);
  });

  it('treats /b/ as “a board, please”', () => {
    expect(boardRoute('/b/', fresh).kind).toBe('board');
  });

  it('ignores a query string when reading the id', () => {
    const boardId = newBoardId();
    expect(boardRoute(`/b/${boardId}?utm=mail`, fresh)).toEqual({ kind: 'board', boardId });
  });

  it('says so when the address names something that is not a board', () => {
    // Not redirected away: this is a link somebody pasted, and it has to stay on screen
    // to be explained.
    expect(boardRoute('/b/nope', fresh)).toEqual({ kind: 'invalid', boardId: 'nope' });
    expect(boardRoute('/b/short', fresh)).toEqual({ kind: 'invalid', boardId: 'short' });
    expect(boardRoute('/b/../etc/passwd', fresh).kind).toBe('invalid');
  });

  it('gives an unrecognised address a board of its own', () => {
    expect(boardRoute('/pricing', fresh)).toEqual({ kind: 'board', boardId: fresh });
  });

  it('round-trips through boardPath', () => {
    const boardId = newBoardId();
    expect(boardRoute(boardPath(boardId), fresh)).toEqual({ kind: 'board', boardId });
  });

  it('never makes up an id that the board id rules would reject', () => {
    for (const pathname of ['/', '/b/', '/anything', '/b/..', '/b/not-a-board']) {
      const route = boardRoute(pathname, fresh);
      if (route.kind === 'board') expect(isValidBoardId(route.boardId)).toBe(true);
    }
  });
});

describe('the badge’s words', () => {
  it('says Connecting… while the first connection is out there', () => {
    expect(connectionLabel('connecting')).toBe('Connecting…');
    expect(connectionIsVisible('connecting')).toBe(true);
  });

  it('says Reconnecting… in words that do not look like the other two', () => {
    const label = connectionLabel('reconnecting');
    expect(label).toBe('Reconnecting…');
    expect(connectionIsVisible('reconnecting')).toBe(true);
    // A reader of the text alone must be able to tell the two apart.
    expect(label).not.toBe(connectionLabel('connecting'));
  });

  it('says nothing at all once the board is live', () => {
    expect(connectionIsVisible('connected')).toBe(false);
    // The words still exist for a test, or a screen reader that asks, to be answered.
    expect(connectionLabel('connected')).toBe('Connected');
  });

  it('has words for a link that is not a board, and shows them', () => {
    expect(connectionIsVisible('invalid-board')).toBe(true);
    expect(connectionLabel('invalid-board').length).toBeGreaterThan(0);
  });
});
