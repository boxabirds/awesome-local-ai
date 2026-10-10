/**
 * TC-04 to TC-06, TC-13, TC-17 — the Worker front door (sync.worker_entry) and
 * what it means for the room behind it (sync.room), inside real workerd: a real
 * `fetch` handler, a real Durable Object namespace, real WebSockets.
 *
 * `TC-04` runs first on purpose: it asserts that *no* Durable Object exists for
 * a board id that is not a board id, and objects live for the whole file.
 */
import { env, listDurableObjectIds, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

import { BoardClient, createNote, settle, synced } from './ws-client';

/** `GET /api/rooms/bad!id` with a real upgrade request (TC-04, negative). */
describe('board id in the room path (TC-04)', () => {
  it('answers 400 and never creates a room object for it', async () => {
    const response = await SELF.fetch('http://permitted.invalid/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('invalid board id');
    // The namespace is never asked for an id, so nothing was instantiated:
    // an invalid id cannot make a room, not even an empty one.
    await expect(listDurableObjectIds(env.BOARD_ROOM)).resolves.toHaveLength(0);
  });

  it('answers 400 for the same id without an upgrade header, too', async () => {
    const response = await SELF.fetch('http://permitted.invalid/api/rooms/bad!id');
    expect(response.status).toBe(400);
  });
});

/** A room path that is a board id but not a handshake (TC-05). */
describe('room path without a handshake (TC-05)', () => {
  it('answers 426 instead of serving the client for a room URL', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://permitted.invalid/api/rooms/${boardId}`);

    expect(response.status).toBe(426);
    await expect(response.text()).resolves.toContain('expected a websocket upgrade');
    // The room object exists by now — 426 comes from the Worker, before the
    // namespace is involved; a plain GET is never forwarded to it.
  });
});

/** The client is a single-page app: `/b/<boardId>` is a route, not a file (TC-06). */
describe('static client and the SPA fallback (TC-06)', () => {
  it('serves index.html for a board route, including the board id in the URL', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://permitted.invalid/b/${boardId}`, {
      headers: { Accept: 'text/html' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    // The same document as `/`, i.e. the client that reads the board id itself.
    const root = await SELF.fetch('http://permitted.invalid/');
    expect(root.status).toBe(200);
    expect(await root.text()).toBe(html);
  });

  it('serves the built client bundle, so the room and the client are one product', async () => {
    const html = await (await SELF.fetch('http://permitted.invalid/')).text();
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(asset, 'index.html must reference the built bundle').toBeTruthy();
    const script = await SELF.fetch(`http://permitted.invalid${asset as string}`);
    expect(script.status).toBe(200);
    expect(script.headers.get('Content-Type')).toContain('javascript');
    // The client speaks the room protocol: y-websocket's framing string is in
    // the bundle that the same Worker serves.
    await expect(script.text()).resolves.toContain('/api/rooms');
  });
});

/** Soft capacity: nobody is ever turned away (live.over_capacity, TC-13). */
describe(`more participants than MAX_CONCURRENT_EDITORS (${MAX_CONCURRENT_EDITORS}) (TC-13)`, () => {
  it('accepts the next person like anybody else, and shows their edits to all the others', async () => {
    const boardId = newBoardId();
    const joiners: BoardClient[] = [];
    try {
      // One more participant than the design's capacity target.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i += 1) {
        const client = await BoardClient.join(boardId);
        await synced(client);
        expect(client.open).toBe(true);
        joiners.push(client);
      }

      // The one over the line creates a note; every other screen gets it.
      const last = joiners.at(-1) as BoardClient;
      createNote(last, { x: 120, y: 80 });

      for (const client of joiners) {
        if (client === last) continue;
        await expect
          .poll(() => client.notes().length, { timeout: 5_000 })
          .toBe(1);
      }
      // And it is the same note, not somebody else's idea of one.
      const positions = joiners.map((client) => client.notes()[0]?.x);
      expect(new Set(positions).size).toBe(1);
    } finally {
      for (const client of joiners) client.leave();
    }
  });
});

/** Boards are separate: different ids, different objects, nothing shared (live.isolation, TC-17). */
describe('two boards at once (TC-17, negative)', () => {
  it('keeps a change on one board off the other, whose document stays empty', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const onA = await BoardClient.join(boardA);
    const onB = await BoardClient.join(boardB);
    try {
      await synced(onA);
      await synced(onB);
      expect(onA.objects().size).toBe(0);
      expect(onB.objects().size).toBe(0);

      createNote(onA, { x: 40, y: 40 });


      // B sees nothing. Waiting for a frame that never comes is the test: the
      // room of A has no idea B exists.
      await settle(onB);
      expect(onB.notes()).toHaveLength(0);
      expect(onB.objects().size).toBe(0);
      expect(onB.received.updates).toBe(0);
      expect(onA.notes()).toHaveLength(1);

      // The reverse direction too, so a board cannot be reached from the side.
      createNote(onB, { x: 90, y: 90 });
      await settle(onA);
      expect(onA.notes()).toHaveLength(1);
      expect(onB.notes()).toHaveLength(1);
    } finally {
      onA.leave();
      onB.leave();
    }
  });

  it('keeps two connections of the same board in one room', async () => {
    const boardId = newBoardId();
    const first = await BoardClient.join(boardId);
    const second = await BoardClient.join(boardId);
    try {
      await synced(first);
      await synced(second);
      const id = createNote(first, { x: 10, y: 10 });
      await expect.poll(() => second.notes().length, { timeout: 5_000 }).toBe(1);
      expect(second.objects().has(id)).toBe(true);
    } finally {
      first.leave();
      second.leave();
    }
  });
});


