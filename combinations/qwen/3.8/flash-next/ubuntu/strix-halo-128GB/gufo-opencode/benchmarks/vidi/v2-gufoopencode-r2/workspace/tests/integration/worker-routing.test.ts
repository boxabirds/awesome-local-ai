// Task 5: Worker routing in workerd (TC-04 to TC-06, TC-13, TC-17).

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { TestClient, createBoard, createNote, snapshotString } from './helpers/ws-client';

const UPGRADE = { upgrade: 'websocket', connection: 'Upgrade' };

describe('worker routing', () => {
  it('TC-04: invalid board id → 404, board namespace never touched', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const response = await SELF.fetch('http://mocked-worker/api/rooms/bad!id', {
      headers: UPGRADE,
    });
    expect(response.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-05: existing board without Upgrade header → 426', async () => {
    const boardId = await createBoard();
    const response = await SELF.fetch(`http://mocked-worker/api/rooms/${boardId}`);
    expect(response.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> → 200 index.html (SPA fallback)', async () => {
    const response = await SELF.fetch(`http://mocked-worker/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted; last joiner edits reach the rest', async () => {
    const boardId = await createBoard();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS + 1 }, () => TestClient.connect(boardId)),
    );
    const [last, ...others] = clients;
    createNote(last, 10, 20);
    await others[0].waitFor(
      () => others.every((c) => c.snapshot().length === 1),
      10_000,
      'all over-capacity clients to see the note',
    );
    expect(others.map(snapshotString)).toEqual(others.map(() => snapshotString(last)));
    for (const client of clients) client.destroy();
  });

  it('TC-17: rooms are isolated; a note in room1 never reaches room2', async () => {
    const board1 = await createBoard();
    const board2 = await createBoard();
    const [a1, b1] = await Promise.all([
      TestClient.connect(board1),
      TestClient.connect(board1),
    ]);
    const [a2, b2] = await Promise.all([
      TestClient.connect(board2),
      TestClient.connect(board2),
    ]);

    createNote(a1, 0, 0);
    await b1.waitFor(() => b1.snapshot().length === 1, 10_000, 'room1 sync');

    for (const bystander of [a2, b2]) {
      expect(bystander.snapshot()).toHaveLength(0);
    }
    // room2's document stays empty even for a fresh joiner after the edit.
    const late = await TestClient.connect(board2);
    expect(late.snapshot()).toHaveLength(0);
    for (const client of [a1, b1, a2, b2, late]) client.destroy();
  });
});
