// sync.worker_entry integration tests: the real Worker `fetch` handler, the real
// static-asset binding and the real Durable Object namespace, driven through
// `SELF.fetch` (no mocks).

import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { RoomClient } from './helpers/ws-client';
import {
  createRoom,
  liveRoomIds,
  roomSnapshot,
  waitForRoom,
  waitForRoomNote,
} from './helpers/room';

const UPGRADE = { headers: { Upgrade: 'websocket' } };

describe('GET /api/rooms/:boardId routing (TC-04, TC-05)', () => {
  // Story 5 made a bad link answer the same way an unknown board does: 404, not 400
  // (share.not_found), so nothing is leaked about which of the two it was.
  it('TC-04 rejects malformed board ids with 404 and creates no object', async () => {
    for (const bad of ['bad!id', 'a'.repeat(23), 'a'.repeat(21), 'short', 'bad*id', 'a'.repeat(40)]) {
      const before = await liveRoomIds();
      const response = await SELF.fetch(
        `https://example.com/api/rooms/${bad}`,
        UPGRADE,
      );
      expect([response.status, bad]).toEqual([404, bad]);
      // No BoardRoom instance was created for a malformed id.
      expect(await liveRoomIds()).toEqual(before);
    }
  });

  it('TC-04 rejects the empty board id with 404 too', async () => {
    const before = await liveRoomIds();
    const response = await SELF.fetch('https://example.com/api/rooms/', UPGRADE);
    expect(response.status).toBe(404);
    expect(await liveRoomIds()).toEqual(before);
  });

  it('TC-05 accepts a valid id with an Upgrade header and answers 426 without one', async () => {
    const boardId = newBoardId();
    // The board has to exist to be joinable (story 5); the object is then already
    // live, so "no new instance" below is still a real assertion.
    expect(await createRoom(boardId)).toBe('created');
    const before = await liveRoomIds();

    const withoutUpgrade: Array<Record<string, string>> = [
      {},
      { Upgrade: 'h2c' },
      { Connection: 'keep-alive' },
    ];
    for (const headers of withoutUpgrade) {
      const response = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, {
        headers,
      });
      expect(response.status).toBe(426);
      // A rejected request must not reach the room either.
      expect(await liveRoomIds()).toEqual(before);
    }

    const upgraded = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, UPGRADE);
    expect(upgraded.status).toBe(101);
    expect(upgraded.webSocket).toBeTruthy();
    upgraded.webSocket!.accept();
    upgraded.webSocket!.close();
  });
});

describe('static assets (TC-06)', () => {
  it('serves index.html for a board address (SPA fallback)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://example.com/b/${boardId}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    expect(html).toContain('assets/');
  });

  it('serves the client at the site root as well', async () => {
    const response = await SELF.fetch('https://example.com/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe('more people than the soft capacity (TC-13)', () => {
  it(`accepts ${MAX_CONCURRENT_EDITORS + 1} clients and syncs the extra one`, async () => {
    const boardId = newBoardId();
    const total = MAX_CONCURRENT_EDITORS + 1;
    const clients: RoomClient[] = [];
    for (let i = 0; i < total; i++) {
      // A refusal would throw here instead of returning a socket.
      clients.push(await RoomClient.connect(boardId));
    }
    for (const client of clients) await client.waitForSync();

    const last = clients[clients.length - 1]!;
    const seenByOthers = clients.map((client) => client.frameCount('update'));
    const id = createSticky(last.doc, { x: 12, y: 34 });
    expect(id).not.toBe('');

    for (const [index, other] of clients.entries()) {
      if (other === last) continue;
      await other.waitForNewFrames('update', seenByOthers[index]!);
      expect(other.snapshot().map((note) => note.id)).toContain(id);
    }
    expect((await waitForRoomNote(boardId, id)).map((note) => note.id)).toContain(id);

    for (const client of clients) client.close();
  });
});

describe('boards stay separate (TC-17)', () => {
  it("never shows one board's changes on another board", async () => {
    const board1 = newBoardId();
    const board2 = newBoardId();
    const alice = await RoomClient.connect(board1);
    const bob = await RoomClient.connect(board2);
    await alice.waitForSync();
    await bob.waitForSync();
    const bobFrames = bob.frameCount('update');

    const aliceId = createSticky(alice.doc, { x: 0, y: 0 }, 'blue');
    await waitForRoomNote(board1, aliceId);

    // Bob received nothing, and his board is still empty — locally and in the room.
    expect(bob.frameCount('update')).toBe(bobFrames);
    expect(bob.snapshot()).toEqual([]);
    expect((await roomSnapshot(board2)).map((note) => note.id)).not.toContain(aliceId);

    // Bob's own board still works, and the two rooms keep their own state. (The
    // room never echoes a change back to the person who made it, so the room's own
    // document is what proves the note landed.)
    const bobId = createSticky(bob.doc, { x: 5, y: 5 }, 'green');
    await waitForRoom(
      board1,
      (notes) => notes.length === 1 && notes[0]!.id === aliceId,
      'room 1 holds only alice\'s note',
    );
    await waitForRoom(
      board2,
      (notes) => notes.length === 1 && notes[0]!.id === bobId,
      'room 2 holds only bob\'s note',
    );
    expect((await roomSnapshot(board1)).map((note) => note.id)).toEqual([aliceId]);
    expect((await roomSnapshot(board2)).map((note) => note.id)).toEqual([bobId]);

    alice.close();
    bob.close();
  });
});
