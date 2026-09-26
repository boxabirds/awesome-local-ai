import { describe, it, expect } from 'vitest';
import { BASE_URL } from './server';
import { RoomClient, settle } from './ws-client';
import { newBoardId } from '@/shared/board-id';
import { createSticky } from '@/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '@/shared/config';

const valid = () => 'A'.repeat(22);

describe('Worker routing (real wrangler dev)', () => {
  it('TC-04: GET /api/rooms/<invalid> -> 404 (id validated before upgrade/DO)', async () => {
    // Story 5 changed malformed room ids from 400 to 404 (share.urls): an
    // invalid id must look exactly like a missing board.
    const res = await fetch(`${BASE_URL}/api/rooms/bad!id`);
    expect(res.status).toBe(404);
    // Also reject traversal / wrong shapes.
    for (const bad of ['../x', 'short', 'A'.repeat(21), 'A'.repeat(23), '++', '']) {
      if (bad === '') continue; // empty segment -> different route
      const r = await fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(bad)}`);
      expect(r.status).toBe(404);
    }
  });

  it('TC-05: GET /api/rooms/<valid> without Upgrade -> 426', async () => {
    const res = await fetch(`${BASE_URL}/api/rooms/${valid()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> -> 200 index.html (SPA fallback)', async () => {
    const res = await fetch(`${BASE_URL}/b/${valid()}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS+1 sockets are all accepted; note reaches all', async () => {
    const boardId = newBoardId();
    const n = MAX_CONCURRENT_EDITORS + 1;
    const clients = Array.from({ length: n }, () => new RoomClient(boardId));
    for (const c of clients) await c.connect();
    for (const c of clients) await c.waitSync();

    // The last (over-capacity) joiner creates a note; it must reach everyone.
    const id = createSticky(clients[n - 1].doc, { x: 1, y: 2 }, 'yellow');
    expect(id).toBeTruthy();
    await settle(600);

    for (const c of clients) {
      const note = c.notes().find((s) => s.id === id);
      expect(note, `client should see the over-capacity note`).toBeTruthy();
    }
    for (const c of clients) c.close();
  }, 30_000);

  it('TC-17: rooms are isolated (a note in room1 never reaches room2)', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = new RoomClient(room1);
    const b = new RoomClient(room2);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();

    const id = createSticky(a.doc, { x: 5, y: 6 }, 'blue');
    expect(id).toBeTruthy();
    await settle(600);

    expect(a.notes().some((s) => s.id === id)).toBe(true);
    // B (room2) must not receive anything; its doc stays empty.
    expect(b.notes().length).toBe(0);
    expect(b.notes().some((s) => s.id === id)).toBe(false);
    expect(b.receivedUpdates).toBe(0);

    a.close();
    b.close();
  }, 30_000);
});
