/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '@shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';
import { createSticky } from '@shared/board-model';
import { createSyncClient, type TestSyncClient } from './ws-client';

describe('TC-04: invalid board id returns 404 (story 5)', () => {
  it('GET /api/rooms/bad!id with Upgrade → 404', async () => {
    const req = new Request('http://localhost/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    const resp = await SELF.fetch(req);
    expect(resp.status).toBe(404);
  });
});

describe('TC-05: valid id without Upgrade returns 426', () => {
  it('GET /api/rooms/<valid> without Upgrade → 426', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/api/rooms/${id}`);
    const resp = await SELF.fetch(req);
    expect(resp.status).toBe(426);
  });
});

describe('TC-06: SPA fallback serves index.html', () => {
  it('GET /b/<valid> → 200 with html', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/b/${id}`);
    const resp = await SELF.fetch(req);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('<!doctype html>');
  });
});

describe('TC-13: over-capacity joiner is accepted', () => {
  it(`opens ${MAX_CONCURRENT_EDITORS + 1} sockets on one board, all get 101, note reaches all`, async () => {
    const boardId = newBoardId();
    const clients: TestSyncClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await createSyncClient(SELF, boardId);
      clients.push(client);
    }

    // All should be connected and synced
    for (const c of clients) {
      expect(c.synced).toBe(true);
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 200 });

    // Wait for propagation
    await new Promise((r) => setTimeout(r, 200));

    // All other clients should see the note
    for (const c of clients) {
      const notes = c.getNotes();
      expect(notes.size).toBe(1);
    }

    // Cleanup
    for (const c of clients) await c.close();
  });
});

describe('TC-17: boards stay separate (isolation)', () => {
  it('client in room1 creates note, client in room2 receives nothing', async () => {
    const board1 = newBoardId();
    const board2 = newBoardId();

    const client1 = await createSyncClient(SELF, board1);
    const client2 = await createSyncClient(SELF, board2);

    // Create a note in room1
    createSticky(client1.doc, { x: 50, y: 50 });

    // Wait
    await new Promise((r) => setTimeout(r, 200));

    // client2's doc should be empty (only meta)
    const notes2 = client2.getNotes();
    expect(notes2.size).toBe(0);

    // client1 should have the note
    const notes1 = client1.getNotes();
    expect(notes1.size).toBe(1);

    await client1.close();
    await client2.close();
  });
});
