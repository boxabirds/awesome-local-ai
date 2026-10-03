/**
 * The Worker's own behaviour, in the real runtime: which request goes where, and
 * what comes back when a request cannot go anywhere.
 *
 * Everything here is a fact about request handling, so nothing is mocked: the
 * requests go through `SELF.fetch` into the same `fetch` handler a browser hits,
 * and the rooms behind it are real Durable Objects.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config';

import { connectRoom, type RoomClient } from './helpers/room-client';

/** A `BoardRoom`'s innards, for the assertions that need to look inside. */
interface RoomInspection {
  sockets: number;
  notes: string[];
}

async function inspect(boardId: string): Promise<RoomInspection> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room) => {
    const target = room as unknown as {
      sockets: Set<WebSocket>;
      ydoc: Y.Doc | null;
    };
    return {
      sockets: target.sockets.size,
      notes: [...target.ydoc!.getMap('objects').keys()],
    };
  });
}

async function upgrade(boardId: string, upgradeHeader = true): Promise<Response> {
  return SELF.fetch(
    new Request(`https://board.test/api/rooms/${boardId}`, {
      headers: upgradeHeader ? { Upgrade: 'websocket' } : {},
    }),
  );
}

describe('worker entry (TC-04 to TC-06)', () => {
  it('answers an upgrade for a valid board with a WebSocket', async () => {
    const boardId = newBoardId();
    const response = await upgrade(boardId);
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeInstanceOf(WebSocket);
    if (socket) {
      socket.accept(); // workerd: the socket is the caller's only after this
      socket.close(1000, 'done');
    }
  });

  it('refuses an invalid board id with 400 and never opens a room (TC-04)', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    // Each of these stays inside `/api/rooms/` once the URL is normalised, so a
    // 400 here can only come from the id check and not from the route not matching.
    for (const bad of ['bad!id', 'short', '', '++++++++++++++++++++++']) {
      const response = await upgrade(bad);
      expect(response.status).toBe(400);
      expect(isValidBoardId(bad)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('answers a valid board id without an upgrade header with 426 (TC-05)', async () => {
    const response = await upgrade(newBoardId(), false);
    expect(response.status).toBe(426);
  });

  it('serves the client for a board address (TC-06)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://board.test/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
  });

  it('serves the client for the app root and its own bundle too (TC-06)', async () => {
    const root = await SELF.fetch('https://board.test/');
    expect(root.status).toBe(200);
    const html = await root.text();
    const asset = /\/assets\/[\w.-]+\.js/.exec(html)?.[0];
    expect(asset, `no bundle referenced in ${html.slice(0, 200)}`).toBeTruthy();
    const bundle = await SELF.fetch(`https://board.test${asset ?? ''}`);
    expect(bundle.status).toBe(200);
  });
});

describe('capacity and isolation (TC-13, TC-17)', () => {
  it('takes one person more than the design capacity and syncs them like anyone else (TC-13)', async () => {
    const boardId = newBoardId();
    const crowd: RoomClient[] = [];
    try {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS + 1; index += 1) {
        crowd.push(await connectRoom(boardId));
      }
      const room = await inspect(boardId);
      expect(room.sockets).toBe(MAX_CONCURRENT_EDITORS + 1);

      // The last person in is the one nobody expected: their note has to reach
      // everyone else, which is the whole promise a 6th person is given.
      const latecomer = crowd[crowd.length - 1];
      if (!latecomer) throw new Error('the crowd is empty');
      const id = createSticky(latecomer.doc, { x: 40, y: 60 });
      for (const other of crowd.slice(0, -1)) {
        await other.waitForNotes(1);
        expect(other.notes()[0]?.id).toBe(id);
        // `createSticky` centres the note on the point it is given.
        expect(other.notes()[0]?.x).toBe(40 - STICKY_SIZE_WORLD / 2);
      }
    } finally {
      for (const client of crowd) client.destroy();
    }
  });

  it('keeps two boards apart (TC-17)', async () => {
    const first = newBoardId();
    const second = newBoardId();
    const alex = await connectRoom(first);
    const sam = await connectRoom(second);
    try {
      createSticky(alex.doc, { x: 0, y: 0 });
      await alex.waitForNotes(1);
      // Give any mis-routed message a chance to turn up before calling it absent.
      await sleep(300);
      expect(sam.notes()).toEqual([]);
      expect(sam.updates).toBe(0);
      const roomTwo = await inspect(second);
      expect(roomTwo.notes).toEqual([]);
      const roomOne = await inspect(first);
      expect(roomOne.notes).toHaveLength(1);
    } finally {
      alex.destroy();
      sam.destroy();
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
