import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ROOM_ROUTE_PREFIX } from '../../src/shared/config';
import { ROOM_WS_ROUTE, roomServerUrl, roomUrl } from '../../src/client/sync/connectBoard';

/**
 * Task 4 (anchor `sync.client`): the room address itself.
 *
 * The provider joins its server URL and the board id with a '/', so a URL that
 * already contains the board id puts a client in the wrong room - which only
 * ever shows up once a second person joins.
 */
describe('room address (sync.client)', () => {
  const board = newBoardId();

  it('uses the shared room route as the WebSocket server path', () => {
    expect(ROOM_WS_ROUTE).toBe(ROOM_ROUTE_PREFIX.replace(/\/+$/, ''));
    expect(ROOM_WS_ROUTE).toBe('/api/rooms');
  });

  it('is the board id appended to the route, once', () => {
    expect(roomUrl(board, 'http://127.0.0.1:24064')).toBe(
      `ws://127.0.0.1:24064/api/rooms/${board}`,
    );
    expect(roomUrl(board, 'https://board.example.com')).toBe(
      `wss://board.example.com/api/rooms/${board}`,
    );
  });

  it('gives the provider a server URL without the board id, because it appends the room name itself', () => {
    expect(roomServerUrl('http://127.0.0.1:24064')).toBe('ws://127.0.0.1:24064/api/rooms');
    expect(roomServerUrl('https://board.example.com/')).toBe('wss://board.example.com/api/rooms');
    // The room name the provider appends is the whole address the browser opens.
    expect(`${roomServerUrl('http://127.0.0.1:24064')}/${board}`).toBe(
      roomUrl(board, 'http://127.0.0.1:24064'),
    );
  });

  it('keeps the port, so a board never reaches another deployment', () => {
    expect(roomServerUrl('http://127.0.0.1:24064')).toContain(':24064');
    expect(roomUrl(board, 'http://127.0.0.1:24064')).not.toContain('://127.0.0.1/api');
  });
});
