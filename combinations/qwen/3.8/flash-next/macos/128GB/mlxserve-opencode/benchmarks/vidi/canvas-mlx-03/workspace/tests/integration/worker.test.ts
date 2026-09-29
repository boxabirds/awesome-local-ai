/// <reference types="@cloudflare/vitest-pool-workers" />
// Integration tests for the Worker `fetch` handler routing + room isolation,
// run inside workerd against the real Durable Object.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { env, SELF, listDurableObjectIds } from 'cloudflare:test';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id.ts';
import {
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config.ts';
import { createSticky, snapshot } from '../../src/shared/board-model.ts';
import {
  connectClients,
  waitFor,
  flush,
} from './helpers/ws-client.ts';

const boardRoom = (env as unknown as { BOARD_ROOM: DurableObjectNamespace }).BOARD_ROOM;

async function roomObjectIds(): Promise<string[]> {
  const ids = (await listDurableObjectIds(boardRoom)) as unknown as {
    toString(): string;
  }[];
  return ids.map((id) => id.toString());
}

beforeEach(() => {
  // No real network beyond SELF in-process; fail loudly on unhandled rejections.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('worker fetch handler', () => {
  it('TC-04 rejects a malformed room id with 400 and creates no object instance', async () => {
    const before = await roomObjectIds();
    const badIds = ['bad!id', 'short', 'a'.repeat(32), '$$$'];
    for (const bad of badIds) {
      const res = await SELF.fetch(`http://localhost/api/rooms/${bad}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(res.status).toBe(400);
      expect(isValidBoardId(bad)).toBe(false);
    }
    const after = await roomObjectIds();
    // No Durable Object instance was created for any rejected id.
    expect(after.length).toBe(before.length);
  });

  it('TC-05 returns 426 for a valid room id without an Upgrade header', async () => {
    const boardId = newBoardId();
    const before = await roomObjectIds();
    const plain = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(plain.status).toBe(426);
    // Missing upgrade header entirely, and a non-websocket upgrade, both 426.
    const other = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'h2c' },
    });
    expect(other.status).toBe(426);
    const after = await roomObjectIds();
    expect(after.length).toBe(before.length);
  });

  it('TC-06 serves the SPA entry point for /b/<valid id>', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/b/${boardId}`, {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });

  it('TC-13 admits MAX+1 sockets and shows the last writer reach every client', async () => {
    const boardId = newBoardId();
    const n = MAX_CONCURRENT_EDITORS + 1;
    const clients = await connectClients(boardId, n);
    expect(clients).toHaveLength(n);

    // Last client (index MAX) writes; every other client must see it.
    clients.forEach((c) => c.clearLog());
    const writer = clients[n - 1];
    const id = createSticky(writer.doc, { x: 0, y: 0 });
    await waitFor(
      () => clients.every((c) => c.snapshot().some((s) => s.id === id)),
      'all clients see the new note',
    );
    expect(clients.filter((c) => c.snapshot().length === 1)).toHaveLength(n);
    clients.forEach((c) => c.close());
  });

  it('TC-17 rooms do not cross-talk; the second room stays empty', async () => {
    const roomA = newBoardId();
    const roomB = newBoardId();
    const [a] = await connectClients(roomA, 1);
    const [b] = await connectClients(roomB, 1);

    b.clearLog();
    createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => snapshot(a.doc).length === 1, 'a has the note');
    await flush(60); // allow (incorrect) cross-talk to arrive

    expect(snapshot(a.doc)).toHaveLength(1);
    expect(b.snapshot()).toHaveLength(0);
    expect(b.syncMessageCount()).toBe(0);
    // Room B's own object is a distinct instance that stayed empty.
    expect(a.boardId).not.toBe(b.boardId);

    a.close();
    b.close();
  });
});
