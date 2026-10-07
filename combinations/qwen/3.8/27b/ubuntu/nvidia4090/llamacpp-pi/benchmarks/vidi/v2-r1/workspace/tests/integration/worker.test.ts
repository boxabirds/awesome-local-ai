// TC-04 to TC-06, TC-13, TC-17: Worker routing integration tests.

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createWsClient } from './ws-client';

describe('Worker routing (sync.worker_entry)', () => {
  it('TC-04: GET /api/rooms/bad!id with Upgrade returns 404 (story 5: malformed is 404, was 400)', async () => {
    const res = await SELF.fetch('http://127.0.0.1/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
  });

  it('TC-05: GET /api/rooms/<valid> without Upgrade returns 426', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://127.0.0.1/api/rooms/${boardId}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> returns 200 (SPA fallback)', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://127.0.0.1/b/${boardId}`);
    expect(res.status).toBe(200);
    // Should return HTML
    const text = await res.text();
    expect(text).toContain('<div id="root">');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted, last one creates a note visible to others', async () => {
    const boardId = newBoardId();
    const clients = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await createWsClient(boardId);
      clients.push(client);
    }

    // Wait for all to sync
    await Promise.all(clients.map((c) => c.waitForSync()));

    // All connections should be open (not refused)
    for (const c of clients) {
      expect(c.ws.readyState).toBe(WebSocket.OPEN);
    }

    // Last client creates a note
    const lastClient = clients[clients.length - 1];
    const doc = lastClient.doc;
    const objects = doc.getMap('objects');
    const map = new Y.Map();
    map.set('type', 'sticky');
    map.set('x', 100);
    map.set('y', 200);
    map.set('color', 'yellow');
    map.set('text', new Y.Text('hello'));
    map.set('z', 1);
    map.set('createdAt', Date.now());
    doc.transact(() => {
      objects.set('tc13-note', map);
    });

    // Wait for all other clients to see the note
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (let i = 0; i < clients.length - 1; i++) {
      const snap = clients[i].snapshot();
      expect(snap.count).toBe(1);
      expect(snap.notes[0].id).toBe('tc13-note');
    }

    // Cleanup
    for (const c of clients) c.close();
  }, 30000);

  it('TC-17: Updates do not cross boards (isolation)', async () => {
    const board1 = newBoardId();
    const board2 = newBoardId();

    const clientA = await createWsClient(board1);
    const clientB = await createWsClient(board2);

    await clientA.waitForSync();
    await clientB.waitForSync();

    // A creates a note on board1
    const objectsA = clientA.doc.getMap('objects');
    const map = new Y.Map();
    map.set('type', 'sticky');
    map.set('x', 50);
    map.set('y', 50);
    map.set('color', 'blue');
    map.set('text', new Y.Text('board1 note'));
    map.set('z', 1);
    map.set('createdAt', Date.now());
    clientA.doc.transact(() => {
      objectsA.set('note-a', map);
    });

    // Wait
    await new Promise((resolve) => setTimeout(resolve, 500));

    // B (on board2) should have an empty board
    const snapB = clientB.snapshot();
    expect(snapB.count).toBe(0);

    // A should have 1 note
    const snapA = clientA.snapshot();
    expect(snapA.count).toBe(1);

    clientA.close();
    clientB.close();
  });
});
