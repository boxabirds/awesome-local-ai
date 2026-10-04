import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createClient, createBoardViaApi, type WsClient } from "./ws-client";
import { createSticky } from '../../src/shared/board-model';

describe('TC-04: invalid board id → 404', () => {
  it('returns 404 for invalid board id with Upgrade header', async () => {
    const response = await SELF.fetch('http://localhost/api/rooms/bad!id', {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
    });
    expect(response.status).toBe(404);
  });
});

describe('TC-05: valid id without Upgrade → 426', () => {
  it('returns 426 for valid board id without Upgrade header', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {});
    expect(response.status).toBe(426);
  });
});

describe('TC-06: SPA fallback', () => {
  it('returns 200 index.html for /b/<valid>', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('<div id="root">');
  });
});

describe('TC-13: over capacity not refused', () => {
  it(`accepts ${MAX_CONCURRENT_EDITORS + 1} sockets and all receive updates`, async () => {
    const boardId = await createBoardViaApi();
    const clients: WsClient[] = [];

    // Open MAX_CONCURRENT_EDITORS + 1 connections
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await createClient(boardId);
      await client.waitForSync();
      clients.push(client);
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 100 });
    lastClient.flush();

    // Wait for all others to receive it
    await new Promise((r) => setTimeout(r, 500));

    for (let i = 0; i < clients.length - 1; i++) {
      const snap = clients[i].getSnapshot();
      expect(snap.length).toBe(1);
      expect(snap[0].x).toBe(100 - 100); // centered at 100, so x = 100 - 100 = 0
    }

    // Clean up
    for (const c of clients) c.close();
  });
});

describe('TC-17: boards stay separate', () => {
  it('updates do not cross boards', async () => {
    const boardId1 = await createBoardViaApi();
    const boardId2 = await createBoardViaApi();

    const clientA = await createClient(boardId1);
    await clientA.waitForSync();

    const clientB = await createClient(boardId2);
    await clientB.waitForSync();

    // A creates a note on board 1
    createSticky(clientA.doc, { x: 50, y: 50 });
    clientA.flush();

    await new Promise((r) => setTimeout(r, 500));

    // B should have no notes
    const snapB = clientB.getSnapshot();
    expect(snapB.length).toBe(0);

    // A should have 1 note
    const snapA = clientA.getSnapshot();
    expect(snapA.length).toBe(1);

    clientA.close();
    clientB.close();
  });
});
