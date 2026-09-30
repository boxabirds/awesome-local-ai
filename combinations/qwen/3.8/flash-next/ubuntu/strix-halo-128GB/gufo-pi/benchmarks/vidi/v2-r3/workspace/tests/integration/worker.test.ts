import { describe, it, expect, afterEach } from 'vitest';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createWsClient } from './ws-client';
import { snapshot, createSticky } from '../../src/shared/board-model';
import { HTTP_BASE } from './global-setup';
import http from 'node:http';

const WS_BASE = HTTP_BASE.replace('http:', 'ws:') + '/api/rooms';

function httpRequest(url: string, options: { headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

const openClients: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const c of openClients) {
    try { c.close(); } catch {}
  }
  openClients.length = 0;
  await new Promise((r) => setTimeout(r, 100));
});

describe('Worker routing (TC-04 to TC-06, TC-13, TC-17)', () => {
  // TC-04: GET /api/rooms/bad!id with Upgrade → 400
  it('TC-04: invalid board id returns 400, no object instance created', async () => {
    const res = await httpRequest(`${HTTP_BASE}/api/rooms/bad!id`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(400);
  });

  // TC-05: valid id without Upgrade → 426
  it('TC-05: valid board id without Upgrade returns 426', async () => {
    const id = newBoardId();
    const res = await httpRequest(`${HTTP_BASE}/api/rooms/${id}`);
    expect(res.status).toBe(426);
  });

  // TC-06: GET /b/<valid> → 200 (SPA fallback)
  it('TC-06: GET /b/<valid> returns index.html (SPA fallback)', async () => {
    const id = newBoardId();
    const res = await httpRequest(`${HTTP_BASE}/b/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });

  // TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted, note reaches all
  it('TC-13: over-capacity joiners are accepted and edits propagate', async () => {
    const boardId = newBoardId();
    const numClients = MAX_CONCURRENT_EDITORS + 1;
    const clients = [];

    for (let i = 0; i < numClients; i++) {
      const client = await createWsClient(WS_BASE, boardId);
      clients.push(client);
    }

    // All connections should be open
    for (const c of clients) {
      expect(c.ws.readyState).toBe(WebSocket.OPEN);
    }

    // Wait for initial sync to complete
    await new Promise((r) => setTimeout(r, 1000));

    // Last client creates a note
    const noteId = createSticky(clients[numClients - 1].doc, { x: 100, y: 200 });
    expect(noteId).toBeTruthy();

    // Wait for propagation
    await new Promise((r) => setTimeout(r, 2000));

    // All clients should see the note
    for (let i = 0; i < clients.length; i++) {
      const snap = snapshot(clients[i].doc);
      expect(snap.length).toBeGreaterThanOrEqual(1);
    }

    for (const c of clients) c.close();
  });

  // TC-17: boards are isolated
  it('TC-17: updates do not cross between different boards', async () => {
    const boardId1 = newBoardId();
    const boardId2 = newBoardId();

    const client1 = await createWsClient(WS_BASE, boardId1);
    const client2 = await createWsClient(WS_BASE, boardId2);

    await new Promise((r) => setTimeout(r, 500));

    // Create a note on board1
    const noteId = createSticky(client1.doc, { x: 50, y: 50 });
    expect(noteId).toBeTruthy();

    // Wait
    await new Promise((r) => setTimeout(r, 2000));

    // client1 should see the note
    expect(snapshot(client1.doc).length).toBe(1);
    // client2 should NOT see the note
    expect(snapshot(client2.doc).length).toBe(0);

    client1.close();
    client2.close();
  });
});
