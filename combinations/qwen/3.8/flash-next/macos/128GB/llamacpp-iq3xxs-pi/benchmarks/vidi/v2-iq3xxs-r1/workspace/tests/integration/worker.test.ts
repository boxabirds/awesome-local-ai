import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import type { Env } from '../../src/worker/index';
import { RoomClient } from './ws-client';

// sync.worker_entry (TC-04, TC-05, TC-06, TC-13, TC-17): routing is an
// integration concern because it needs the real `wrangler.jsonc` assets binding,
// the single-page-application fallback and Durable Object instance routing.
// Board ids come from the id generator, never from a hand-written string.

/** The socket a 101 response carries, or null when it carries none. */
const socketOf = (response: Response): WebSocket | null => response.webSocket ?? null;

/** The Worker's own bindings, from inside the test worker. */
const boardRoom = () => (env as unknown as Env).BOARD_ROOM;

describe('board route (TC-04)', () => {
  for (const badId of ['bad!id', '..%2F..%2Fx', 'a'.repeat(21), 'a'.repeat(23), 'KWobTWj7bGzX9Hx3YQ+']) {
    it(`refuses "${badId}" with 400 and creates no room`, async () => {
      const idFromName = vi.spyOn(boardRoom(), 'idFromName');
      const response = await SELF.fetch(`http://worker/api/rooms/${badId}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(response.status).toBe(400);
      expect(socketOf(response)).toBeNull();
      expect(idFromName).not.toHaveBeenCalled(); // the room never exists
      idFromName.mockRestore();
    });
  }

  it('keeps near-miss paths away from the room handler', async () => {
    const boardId = RoomClient.newBoardId();
    const nearMisses = [
      `/api/rooms/${boardId}/`,
      `/api/rooms/${boardId}/extra`,
      `/api/rooms/`,
      `/api/rooms/../../x`,
      `/api/room/${boardId}`,
      `/api/rooms2/${boardId}`,
    ];
    const idFromName = vi.spyOn(boardRoom(), 'idFromName');
    for (const path of nearMisses) {
      const response = await SELF.fetch(`http://worker${path}`, { headers: { Upgrade: 'websocket' } });
      // Neither an upgrade nor a room rejection: an asset request the SPA fallback
      // answers, so the room handler was never reached.
      expect(response.status, path).toBe(200);
      expect(socketOf(response), path).toBeNull();
      expect(await response.text(), path).toContain('<div id="root">');
    }
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });
});

describe('room path without a websocket upgrade (TC-05)', () => {
  it('answers 426 and leaves the sockets it already has alone', async () => {
    const boardId = RoomClient.newBoardId();
    const editor = await RoomClient.connect(boardId, 'editor');
    const watcher = await RoomClient.connect(boardId, 'watcher');

    for (const upgrade of [null, 'hypertext/connection']) {
      const response = await RoomClient.rawUpgrade(boardId, upgrade);
      expect(response.status, String(upgrade)).toBe(426);
      expect(socketOf(response), String(upgrade)).toBeNull();
    }

    // Nothing was closed by the plain requests: the room still relays.
    createSticky(editor.doc, { x: 240, y: 180 });
    await watcher.waitFor(() => watcher.notes.length === editor.notes.length, 'relay after 426');
    editor.destroy();
    watcher.destroy();
  });
});

describe('static fallback (TC-06)', () => {
  it('serves the client shell for / and for a fresh board URL', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const response = await SELF.fetch(`http://worker${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('Content-Type'), path)?.toContain('text/html');
      expect(await response.text(), path).toContain('<div id="root">');
    }
  });
});

describe('over-capacity joiners (TC-13)', () => {
  it(`upgrades ${MAX_CONCURRENT_EDITORS + 1} sockets and relays for all of them`, async () => {
    const boardId = RoomClient.newBoardId();
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      // The 6th socket is not refused: nothing counts participants (PRD
      // live.over_capacity), so a plain `connect` is all it takes.
      clients.push(await RoomClient.connect(boardId, `editor-${i}`));
      await clients[clients.length - 1]!.waitForSync();
    }
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);

    const last = clients[clients.length - 1]!;
    createSticky(last.doc, { x: 400, y: 400 });
    for (const client of clients.slice(0, -1)) {
      await client.waitFor(() => client.notes.length === 1, 'note from the last joiner');
    }
    for (const client of clients) client.destroy();
  });
});

describe('board isolation (TC-17)', () => {
  it('never carries a change from one board to another', async () => {
    const board1 = RoomClient.newBoardId();
    const board2 = RoomClient.newBoardId();
    const first = await RoomClient.connect(board1, 'on-board-1');
    const firstWatcher = await RoomClient.connect(board1, 'watcher-on-1');
    const second = await RoomClient.connect(board2, 'on-board-2');

    createSticky(first.doc, { x: 10, y: 10 });
    createSticky(first.doc, { x: 20, y: 20 });
    // The relay demonstrably works on board 1…
    await firstWatcher.waitFor(() => firstWatcher.notes.length === 2, 'board 1 relayed');
    await first.waitForSync();

    // …while board 2's socket had every chance to receive and received nothing.
    await second.waitFor(() => second.notes.length === 0, 'board 2 untouched');
    await second.waitForSync();
    expect(second.notes).toHaveLength(0);

    for (const client of [first, firstWatcher, second]) client.destroy();
  });
});
