import { describe, it, expect } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { connectClient, integrationFetch, createBoard, type WsTestClient } from './ws-client';

describe('sync.worker_entry', () => {
  // TC-04: invalid board id → 404; no object instance created
  it('TC-04: returns 404 for invalid board id', async () => {
    // Note: Node's fetch doesn't allow custom Upgrade headers, but the Worker
    // checks ID validity BEFORE checking Upgrade, so a plain GET to an invalid
    // board ID still returns 404.
    const res = await integrationFetch('/api/rooms/bad!id');
    expect(res.status).toBe(404);
  });

  // TC-05: valid id without Upgrade → 426
  it('TC-05: returns 426 for valid board id without Upgrade header', async () => {
    const id = await createBoard();
    const res = await integrationFetch(`/api/rooms/${id}`);
    expect(res.status).toBe(426);
  });

  // TC-06: GET /b/<valid> → 200 index.html (SPA fallback)
  it('TC-06: returns 200 with HTML for /b/<valid> (SPA fallback)', async () => {
    const id = newBoardId();
    const res = await integrationFetch(`/b/${id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('<div id="root">');
  });

  // TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted; note from last reaches all others
  it('TC-13: more than MAX_CONCURRENT_EDITORS can connect and sync', async () => {
    const boardId = await createBoard();
    const clients: WsTestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await connectClient(boardId);
      clients.push(client);
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 100 });
    // Send the update via SyncStep2
    lastClient.sendSyncStep2();

    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 500));

    // All other clients should see the new note
    for (let i = 0; i < clients.length - 1; i++) {
      const snap = clients[i].getSnapshot();
      expect(snap.length).toBeGreaterThanOrEqual(1);
    }

    // Clean up
    for (const c of clients) c.close();
  });

  // TC-17: boards stay separate
  it('TC-17: updates do not cross between boards', async () => {
    const board1 = await createBoard();
    const board2 = await createBoard();

    const client1 = await connectClient(board1);
    const client2 = await connectClient(board2);

    // Client 1 creates a note on board1
    createSticky(client1.doc, { x: 50, y: 50 });
    client1.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 300));

    // Client 2 on board2 should not see it
    expect(client2.getSnapshot().length).toBe(0);

    // Client 1 should have the note
    expect(client1.getSnapshot().length).toBe(1);

    client1.close();
    client2.close();
  });
});
