import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, URL, createBoard } from './server';
import { createTestClient, waitForCondition } from './ws-client';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';

describe('Worker routing integration tests', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it('TC-04: GET /api/rooms/bad!id → 404 (story 5: was 400 in story 3)', async () => {
    // The worker validates the board id before checking for Upgrade; story 5
    // collapsed 400 into 404 so unknown and malformed ids are indistinguishable.
    const resp = await fetch(`${URL}/api/rooms/bad%21id`);
    expect(resp.status).toBe(404);
  });

  it('TC-05: valid id without Upgrade → 426', async () => {
    const boardId = newBoardId();
    const resp = await fetch(`${URL}/api/rooms/${boardId}`);
    expect(resp.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> → 200 (SPA fallback)', async () => {
    const boardId = newBoardId();
    const resp = await fetch(`${URL}/b/${boardId}`);
    expect(resp.status).toBe(200);
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted; last client\'s note reaches all others', async () => {
    const boardId = await createBoard();
    const clients = [];

    // Open MAX_CONCURRENT_EDITORS + 1 connections
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await createTestClient(URL, boardId);
      initDoc(client.doc);
      clients.push(client);
    }

    // All should be connected (no close)
    for (const c of clients) {
      expect(c.closeCode).toBeNull();
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 100 });

    // Wait for all other clients to see the note
    await Promise.all(clients.slice(0, -1).map((c) =>
      waitForCondition(() => snapshot(c.doc).length === 1, 20000, 'note to appear')
    ));

    // All clients should see exactly 1 note
    for (const c of clients) {
      expect(snapshot(c.doc).length).toBe(1);
    }

    // Cleanup
    for (const c of clients) c.destroy();
  });

  it('TC-17: boards are isolated - changes in room1 do not appear in room2', async () => {
    const boardId1 = await createBoard();
    const boardId2 = await createBoard();

    const client1 = await createTestClient(URL, boardId1);
    const client2 = await createTestClient(URL, boardId2);
    initDoc(client1.doc);
    initDoc(client2.doc);

    // Client1 creates a note
    createSticky(client1.doc, { x: 50, y: 50 });

    // Wait a bit for any (incorrect) propagation
    await new Promise(r => setTimeout(r, 500));

    // Client2 should have an empty board
    expect(snapshot(client2.doc).length).toBe(0);

    // Client1 should have 1 note
    expect(snapshot(client1.doc).length).toBe(1);

    client1.destroy();
    client2.destroy();
  });
});
