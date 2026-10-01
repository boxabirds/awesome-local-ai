import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { createSticky } from '../../src/shared/board-model.ts';
import { connectToBoard, WsClient } from './helpers/ws-client.ts';

describe('Worker routing', () => {
  it('TC-04: GET /api/rooms/bad!id returns 400', async () => {
    const response = await SELF.fetch(`http://localhost/api/rooms/bad!id`);
    expect(response.status).toBe(400);
  });

  it('TC-05: valid id without Upgrade returns 426', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(response.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> returns 200 (SPA fallback)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(response.status).toBe(200);
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted, note reaches all', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await connectToBoard(boardId);
      clients.push(client);
    }

    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 100 });

    await new Promise((r) => setTimeout(r, 500));

    for (let i = 0; i < clients.length - 1; i++) {
      expect(clients[i].getNoteCount()).toBe(1);
    }

    for (const c of clients) {
      c.destroy();
    }
  });

  it('TC-17: boards are isolated - updates do not cross boards', async () => {
    const boardId1 = newBoardId();
    const boardId2 = newBoardId();

    const client1 = await connectToBoard(boardId1);
    const client2 = await connectToBoard(boardId2);

    createSticky(client1.doc, { x: 50, y: 50 });

    await new Promise((r) => setTimeout(r, 500));

    expect(client2.getNoteCount()).toBe(0);

    client1.destroy();
    client2.destroy();
  });
});
