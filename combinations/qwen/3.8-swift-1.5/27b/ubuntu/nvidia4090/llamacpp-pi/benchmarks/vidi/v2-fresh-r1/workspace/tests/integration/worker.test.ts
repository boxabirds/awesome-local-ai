// Integration tests for the Worker entry (sync.worker_entry) in workerd:
// real `fetch` handler, real Durable Object namespace, no mocks.
// TC-04 to TC-06, TC-13, TC-17.

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createSticky } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { RoomClient, closeAll, waitForConvergence } from './ws-client';

const UPGRADE_HEADERS = { Upgrade: 'websocket', Connection: 'Upgrade' };

describe('worker routing', () => {
  it('TC-04: invalid board id with Upgrade -> 400, no object instance touched', async () => {
    const idSpy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const res = await SELF.fetch('http://localhost/api/rooms/bad!id', {
      headers: UPGRADE_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(res.webSocket).toBeNull();
    expect(idSpy).not.toHaveBeenCalled();
    idSpy.mockRestore();
  });

  it('TC-05: valid board id without Upgrade header -> 426', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(res.status).toBe(426);
    expect(res.webSocket).toBeNull();
  });

  it('TC-06: GET /b/<valid> -> 200 index.html (SPA fallback)', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });

  it(`TC-13: ${MAX_CONCURRENT_EDITORS + 1} participants are all accepted (over capacity not refused)`, async () => {
    const boardId = newBoardId();
    const clients: RoomClient[] = [];
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
        clients.push(await RoomClient.connect(boardId));
      }
      // The last (over-capacity) participant creates a note.
      const last = clients[clients.length - 1];
      createSticky(last.doc, { x: 10, y: 10 });
      // Every other participant receives the update.
      for (const c of clients.slice(0, -1)) {
        await c.waitForUpdates(1);
      }
      await waitForConvergence(clients);
      for (const c of clients) {
        expect(c.snapshot().length).toBe(1);
      }
    } finally {
      await closeAll(clients);
    }
  }, 30_000);

  it('TC-17: boards stay separate (no cross-room updates)', async () => {
    const board1 = newBoardId();
    const board2 = newBoardId();
    const a = await RoomClient.connect(board1);
    const b = await RoomClient.connect(board2);
    try {
      createSticky(a.doc, { x: 0, y: 0 });
      // Give any (incorrect) cross-room broadcast time to arrive.
      await new Promise((r) => setTimeout(r, 200));
      expect(b.snapshot().length).toBe(0);
      expect(b.updates.length).toBe(0);
      // room2's doc stays empty
      expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify([]));
      // a's board has the note
      expect(a.snapshot().length).toBe(1);
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);
});
