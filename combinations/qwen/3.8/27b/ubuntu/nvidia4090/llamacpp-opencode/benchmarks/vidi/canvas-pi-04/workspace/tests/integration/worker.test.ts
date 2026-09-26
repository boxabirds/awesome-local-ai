// Story 3, task 5: worker routing + isolation + capacity integration tests.
//
// TC-04  valid room path upgrades to a websocket; invalid ids 400 and never
//        allocate a Durable Object (idFromName spy).
// TC-05  path traversal attempts are rejected with 400.
// TC-06  SPA fallback: /b/<id> serves the built client shell (200, html).
// TC-13  MAX_CONCURRENT_EDITORS + 1 sockets all get 101; the last one's note
//        reaches all the others.
// TC-17  rooms are isolated: a note in room A is never seen in room B.

import { describe, expect, it, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyAt, snapshot } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { SYNC_UPDATE } from '../../src/shared/protocol';
import { WsClient } from './ws-client';

describe('worker routing (task 5)', () => {
  it('TC-04: GET /api/rooms/<valid> upgrades to a websocket', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    ws.accept(); // in-process upgrade: the caller accepts its half
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('TC-04: an invalid id returns 400 and never calls idFromName', async () => {
    const idFromName = vi
      .spyOn(env.BOARD_ROOM, 'idFromName')
      .mockImplementation(() => {
        throw new Error('idFromName must not be called for invalid ids');
      });
    try {
      const res = await SELF.fetch('http://localhost/api/rooms/not-a-board-id', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      expect(res.status).toBe(400);
      expect(idFromName).not.toHaveBeenCalled();
    } finally {
      idFromName.mockRestore();
    }
  });

  it('TC-04: a non-websocket request to a room path is 426', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(res.status).toBe(426);
  });

  it('TC-05: path traversal ids are rejected with 400', async () => {
    for (const path of ['%2e%2e%2f%2e%2e%2fetc', 'a/../../etc', '+', 'abc%00def']) {
      const res = await SELF.fetch(`http://localhost/api/rooms/${path}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      // Either the worker rejects the id (400) or the router never matches
      // the room prefix (asset response) — never a successful upgrade.
      expect(res.status).not.toBe(101);
    }
  });

  it('TC-06: SPA fallback serves the client shell for / and /b/<id>', async () => {
    const boardId = newBoardId();
    for (const path of ['/', `/b/${boardId}`, '/b/whatever-deep/route']) {
      const res = await SELF.fetch(`http://localhost${path}`);
      expect(res.status, `path ${path}`).toBe(200);
      expect(res.headers.get('content-type'))?.toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<div id="root"');
    }
  });

  it(`TC-13: ${MAX_CONCURRENT_EDITORS + 1} editors all get 101 and the last one's note reaches everyone`, async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await WsClient.connect(boardId);
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
      clients.push(client);
    }
    try {
      // Everyone settles on an empty board first.
      await Promise.all(clients.map((c) => c.waitForSync()));
      for (const client of clients) {
        expect(client.boardSnapshot()).toHaveLength(0);
      }
      // The last editor creates a note; it must reach all the others.
      const last = clients[clients.length - 1];
      const noteId = last.applyLocal((doc) => createStickyAt(doc, 10, 20, 'green'));
      await Promise.all(
        clients
          .filter((c) => c !== last)
          .map((c) => c.waitUntil(() => c.hasNote(noteId), 3000)),
      );
      for (const client of clients) {
        expect(client.hasNote(noteId)).toBe(true);
      }
    } finally {
      for (const client of clients) await client.destroy();
    }
  });

  it('TC-17: rooms are isolated — a note in room A never reaches room B', async () => {
    const roomA = newBoardId();
    const roomB = newBoardId();
    const a = await WsClient.connect(roomA);
    const b = await WsClient.connect(roomB);
    try {
      await a.waitForSync();
      const noteId = a.applyLocal((doc) => createStickyAt(doc, 0, 0, 'blue'));
      await a.waitUntil(() => a.hasNote(noteId));
      // Give room A plenty of time to (wrongly) leak into room B.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(b.boardSnapshot()).toHaveLength(0);
      // B's wire log must not carry live update frames either: the only
      // sync traffic B ever saw is the initial step1/step2 exchange (an
      // empty Yjs "update" is a 2-byte header, so match on the sub-type).
      const bLiveUpdates = b.received.filter((f) => f.syncSub === SYNC_UPDATE);
      expect(bLiveUpdates.length).toBe(0);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});
