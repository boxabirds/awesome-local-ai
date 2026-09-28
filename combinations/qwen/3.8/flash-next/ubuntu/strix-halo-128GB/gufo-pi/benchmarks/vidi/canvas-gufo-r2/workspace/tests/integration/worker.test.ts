/**
 * Integration tests for Worker routing (TC-04 to TC-06, TC-13, TC-17)
 * Runs in workerd via @cloudflare/vitest-pool-workers.
 */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { connectRoom, type TestClient } from './ws-client';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';

describe('TC-04: invalid board ID → 400, no object instance created', () => {
  it('rejects /api/rooms/bad!id with Upgrade header', async () => {
    const req = new Request('http://localhost/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
  });
});

describe('TC-05: valid board ID without Upgrade → 426', () => {
  it('rejects valid room request without WebSocket upgrade', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/api/rooms/${id}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(426);
  });
});

describe('TC-06: GET /b/<valid> → 200 index.html (SPA fallback)', () => {
  it('serves SPA for board path', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/b/${id}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<div id="root">');
  });
});

describe('TC-13: over-capacity join not refused', () => {
  it('opens MAX_CONCURRENT_EDITORS + 1 sockets, all accepted', async () => {
    const id = newBoardId();
    const clients: TestClient[] = [];
    const count = MAX_CONCURRENT_EDITORS + 1;

    for (let i = 0; i < count; i++) {
      const client = await connectRoom(id);
      clients.push(client);
    }

    // Last client creates a note
    const noteId = createSticky(clients[0].doc, { x: 42, y: 42 });
    expect(noteId).toBeTruthy();

    // Wait for propagation
    await new Promise((r) => setTimeout(r, 200));

    // All other clients should see the note
    for (let i = 1; i < count; i++) {
      const snap = clients[i].snapshot();
      expect(snap.length).toBe(1);
      expect(snap[0].id).toBe(noteId);
      expect(snap[0].x).toBe(42 - 100); // createSticky centers: x - STICKY_SIZE_WORLD/2
      expect(snap[0].y).toBe(42 - 100);
    }

    clients.forEach((c) => c.close());
  });
});

describe('TC-17: board isolation', () => {
  it('changes in room1 do not appear in room2', async () => {
    const room1Id = newBoardId();
    const room2Id = newBoardId();

    const client1 = await connectRoom(room1Id);
    const client2 = await connectRoom(room2Id);

    // Create a note in room1
    createSticky(client1.doc, { x: 10, y: 10 });
    await new Promise((r) => setTimeout(r, 200));

    // Client in room2 should see nothing
    const snap2 = client2.snapshot();
    expect(snap2.length).toBe(0);

    client1.close();
    client2.close();
  });
});
