/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * The Worker entry (`sync.worker_entry`): the real `fetch` handler, reached
 * through `SELF.fetch`, with the real Durable Object namespace behind it.
 *
 * Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
 * design.md, section "Worker entry and routing".
 */
import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { seeSameBoard, SyncClient, tick, waitFor } from './helpers/ws-client';

const upgradeHeaders = { Upgrade: 'websocket', Connection: 'Upgrade' };

/** How many room objects this Worker run has actually been asked to create. */
let roomsInvoked = 0;
const roomNamespace = env.BOARD_ROOM;
const realGet = roomNamespace.get.bind(roomNamespace);
(env.BOARD_ROOM as unknown as { get: (...args: unknown[]) => unknown }).get = (
  ...args: unknown[]
) => {
  roomsInvoked++;
  return realGet(...(args as [never]));
};

const countRoomObjects = async (run: () => Promise<unknown>): Promise<number> => {
  const before = roomsInvoked;
  await run();
  return roomsInvoked - before;
};

describe('the board address (sync.worker_entry)', () => {
  // TC-04 (share.not_found): an address that is not a board id is refused with
  // 404 — story 5 made "not a board" a 404, the same answer an unknown id gets —
  // and no room object is created for it (negative scenario).
  it('refuses an address that is not a board id and creates nothing for it (TC-04)', async () => {
    const before = roomsInvoked;
    const response = await SELF.fetch('https://vidi6.test/api/rooms/bad!id', {
      headers: upgradeHeaders,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(roomsInvoked).toBe(before);

    // The same for the other shapes a person might paste: too short, too long,
    // a character base64url does not use, an encoded traversal, no id at all.
    for (const bad of [
      'x'.repeat(21),
      'x'.repeat(23),
      'AB+CD_ef-gh%0123456789',
      '..%2F..%2Fetc%2Fpasswd',
      '',
    ]) {
      const other = await SELF.fetch(`https://vidi6.test/api/rooms/${bad}`, {
        headers: upgradeHeaders,
      });
      expect(other.status, bad).toBe(404);
    }
    expect(roomsInvoked, 'no invalid address reaches the namespace').toBe(before);

    // A traversal that the URL parser resolves away never reaches a room
    // either: `/api/rooms/../../etc/passwd` is a request for `/etc/passwd`.
    const traversal = await SELF.fetch('https://vidi6.test/api/rooms/../../etc/passwd', {
      headers: upgradeHeaders,
    });
    expect(traversal.status).toBe(200);
    expect(roomsInvoked, 'a resolved traversal creates no room either').toBe(before);
  });

  // TC-05: valid id, no upgrade → 426 (and still no object).
  it('answers a connection request that never asked for an upgrade (TC-05)', async () => {
    const before = roomsInvoked;
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.test/api/rooms/${boardId}`);

    expect(response.status).toBe(426);
    expect(await response.json()).toEqual({
      error: { code: 'websocket_upgrade_required', message: 'Connect to this room with `Upgrade: websocket`.' },
    });
    expect(roomsInvoked).toBe(before);
  });

  // TC-06: the SPA fallback the client depends on.
  it('serves the app for a board address typed into the browser (TC-06)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.test/b/${boardId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
    expect(roomsInvoked, 'the app shell is not a room').toBe(0);
  });

  // TC-13: full capacity plus one. Nobody is turned away.
  it(
    `connects the ${MAX_CONCURRENT_EDITORS + 1}th person and shows everyone their note (TC-13)`,
    async () => {
      const boardId = newBoardId();
      const clients: SyncClient[] = [];
      for (let index = 0; index <= MAX_CONCURRENT_EDITORS; index++) {
        clients.push(await SyncClient.connect(boardId));
      }
      await Promise.all(clients.map((client) => client.waitForSync()));

      // The last one is the 6th person on a board designed for 5.
      const noteId = clients[clients.length - 1]?.addNote({ x: 40, y: 60 });
      expect(noteId).toBeTruthy();
      await waitFor(
        () => seeSameBoard(...clients),
        'every other screen to see the note the last person created',
      );
      expect(clients[0]?.notes.length).toBe(1);

      for (const client of clients) client.close();
    },
  );

  // TC-17: two boards, two rooms. What happens on one is not seen on the other.
  it('keeps two boards apart so a note never crosses over (TC-17)', async () => {
    const boardOne = newBoardId();
    const boardTwo = newBoardId();
    const one = await SyncClient.connect(boardOne);
    const two = await SyncClient.connect(boardTwo);
    await Promise.all([one.waitForSync(), two.waitForSync()]);

    const noteId = one.addNote({ x: 0, y: 0 });
    one.type(noteId, 'only on board one');
    await waitFor(() => one.notes.length === 1, 'the note to be on its own board');
    // Board two's room answered its SyncStep1 — it exists, and it is a different room.
    expect(two.syncStep1s).toBeGreaterThanOrEqual(1);

    await tick(200);
    expect(two.notes.length).toBe(0);
    expect(two.updates.length).toBe(0);
    expect(two.syncStep2s).toBe(1); // its own empty state, nothing from board one

    one.close();
    two.close();
  });

  it('opens no room for anything that is not a connection (TC-04, negative)', async () => {
    const before = roomsInvoked;
    for (const path of ['/', `/b/${newBoardId()}`, '/a-missing-asset.css']) {
      const response = await SELF.fetch(`https://vidi6.test${path}`);
      expect(response.status, path).toBe(200);
    }
    expect(roomsInvoked).toBe(before);
  });

  it('answers an upgrade on the bare room path with a 404 (TC-04, boundary)', async () => {
    const response = await SELF.fetch('https://vidi6.test/api/rooms/', {
      headers: upgradeHeaders,
    });
    expect(response.status).toBe(404);
  });

  it('counts the room objects a request asks for', async () => {
    expect(await countRoomObjects(() => SELF.fetch('https://vidi6.test/'))).toBe(0);
    expect(
      await countRoomObjects(async () => {
        const response = await SELF.fetch(`https://vidi6.test/api/rooms/${newBoardId()}`, {
          headers: upgradeHeaders,
        });
        response.webSocket?.accept();
        response.webSocket?.close();
      }),
    ).toBe(1);
  });
});
