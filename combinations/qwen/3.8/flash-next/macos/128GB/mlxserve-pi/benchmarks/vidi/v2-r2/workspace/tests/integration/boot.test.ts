import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { createdBoardId } from './helpers/room';

// Gate: prove the workerd pool boots under this vitest and that a WebSocket
// upgrade returns a client socket we can drive.
describe('workerd boot', () => {
  it('has the BOARD_ROOM namespace binding', () => {
    expect(typeof env.BOARD_ROOM.idFromName).toBe('function');
    expect(typeof env.BOARD_ROOM.newUniqueId).toBe('function');
  });

  it('upgrades a valid board id to a WebSocket', async () => {
    // Story 5: the board has to exist for its room to accept a socket, so this
    // creates one first - the same call `POST /api/boards` makes.
    const boardId = await createdBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const client = (res as unknown as { webSocket?: WebSocket }).webSocket;
    expect(client).toBeTruthy();
    client!.accept();
    client!.close();
  });

  it('refuses a valid board id without an upgrade (426)', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('answers an invalid board id with an upgrade (404)', async () => {
    // Was 400 until story 5: a malformed address is answered the same way an empty
    // one is, so a page has one thing to handle and no board to show either way.
    const res = await SELF.fetch('http://localhost/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
  });
});
