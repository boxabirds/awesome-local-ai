/**
 * Worker entry routing (task 5): TC-04, TC-05, TC-06, TC-13, TC-17.
 *
 * Runs inside workerd against the real Worker: `SELF.fetch` is the Worker's own
 * `fetch`, so the assertions below cover the routing rules and nothing else.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { createSticky } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { boardState, connectAll, converge, ensureBoard, freshBoardId, RoomClient } from './ws-client';

const VALID_ID = newBoardId();

const roomUrl = (path: string) => `http://whiteboard.local${path}`;

/** Watch `BOARD_ROOM.idFromName`, the one call that materialises a room. */
function watchIdFromName() {
  const namespace = env.BOARD_ROOM;
  const calls: string[] = [];
  const spy = vi.spyOn(namespace, 'idFromName');
  return {
    calls,
    count: () => spy.mock.calls.length,
    restore: () => spy.mockRestore(),
    namespace,
  };
}

describe('board routes (TC-04, TC-06)', () => {
  it('serves index.html for a board route', async () => {
    const response = await SELF.fetch(roomUrl(`/b/${VALID_ID}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
  });

  it('still serves the root document and assets', async () => {
    const root = await SELF.fetch(roomUrl('/'));
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('<div id="root">');

    const index = await SELF.fetch(roomUrl('/index.html'));
    expect(index.status).toBe(200);

    const html = await SELF.fetch(roomUrl('/index.html'), { headers: { upgrade: 'websocket' } });
    expect(html.status).toBe(200);

    const css = await SELF.fetch(roomUrl('/styles.css'));
    expect([200, 404]).toContain(css.status);
  });

  it('serves index.html for any client route', async () => {
    for (const path of ['/some/deep/route', '/favicon.ico']) {
      const response = await SELF.fetch(roomUrl(path));
      expect(response.status, path).toBe(200);
    }
  });
});

describe('room sockets (TC-05, TC-13)', () => {
  // Story 5 changed a malformed board id from 400 to 404 (share.not_found): a
  // probe must not be able to tell a malformed id from an unknown one, and the
  // id must still never reach a Durable Object.
  it('answers 404 for a bad board id without touching a Durable Object', async () => {
    const watched = watchIdFromName();
    try {
      const before = watched.count();
      const response = await SELF.fetch(roomUrl('/api/rooms/bad!id'), {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status).toBe(404);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(watched.count()).toBe(before);
    } finally {
      watched.restore();
    }
  });

  it('answers 404 for too-short, too-long and non-base64url ids', async () => {
    const invalid = ['', 'short', 'a'.repeat(23), 'has spaces!!!!!!!!!!!!!!', 'üüüüüüüüüüüüüüüüüüüü'];
    for (const id of invalid) {
      const response = await SELF.fetch(roomUrl(`/api/rooms/${encodeURIComponent(id)}`), {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status, `id ${JSON.stringify(id)}`).toBe(404);
    }
  });

  it('upgrades a valid board id once the board exists', async () => {
    // Connecting no longer creates a board (story 5), so create it first through
    // the real API, then measure only the socket's Durable Object lookup.
    const created = await SELF.fetch(roomUrl('/api/boards'), { method: 'POST' });
    const { id: boardId } = (await created.json()) as { id: string };
    const watched = watchIdFromName();
    try {
      const before = watched.count();
      const response = await SELF.fetch(roomUrl(`/api/rooms/${boardId}`), {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status).toBe(101);
      expect(response.webSocket).toBeDefined();
      expect(watched.count()).toBe(before + 1);
      response.webSocket?.accept();
      response.webSocket?.close();
    } finally {
      watched.restore();
    }
  });

  it('never serves the static asset bundle from the room path', async () => {
    const response = await SELF.fetch(roomUrl(`/api/rooms/${freshBoardId()}`));
    expect(response.status).toBe(426);
    expect(await response.text()).not.toContain('<div id="root">');
  });
});

describe('bad requests never create rooms (TC-04)', () => {
  it('creates no instance for a rejected socket', async () => {
    const watched = watchIdFromName();
    try {
      const before = watched.count();
      await SELF.fetch(roomUrl('/api/rooms/!!!(not an id)'), { headers: { upgrade: 'websocket' } });
      await SELF.fetch(roomUrl('/api/rooms/'), { headers: { upgrade: 'websocket' } });
      expect(watched.count()).toBe(before);
    } finally {
      watched.restore();
    }
  });
});

describe(`capacity is soft (TC-13: ${MAX_CONCURRENT_EDITORS + 1} sockets)`, () => {
  it('accepts everybody and relays to all of them', async () => {
    const boardId = freshBoardId();
    // Create the board before watching, so the only `idFromName` calls counted are
    // the routing's own — one per socket (story 5 keeps creation out of joining).
    await ensureBoard(boardId);
    const watched = watchIdFromName();
    try {
      const before = watched.count();
      const clients = await connectAll(boardId, MAX_CONCURRENT_EDITORS + 1);
      expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);
      // Every socket was routed to the same room, and one room is enough.
      expect(watched.count() - before).toBe(MAX_CONCURRENT_EDITORS + 1);

      const last = clients[clients.length - 1]!;
      createSticky(last.doc, { x: 42, y: 42 });
      for (const client of clients.slice(0, -1)) await client.seesNoteCount(1);
      await converge(clients);

      for (const client of clients) client.destroy();
    } finally {
      watched.restore();
    }
  });
});

describe('boards are separate (TC-17)', () => {
  it('never lets an update cross rooms', async () => {
    const room1 = freshBoardId();
    const room2 = freshBoardId();
    const [alex, sam] = await connectAll(room1, 2);
    const other = await RoomClient.connect(room2);

    createSticky(alex.doc, { x: 1, y: 1 });
    await sam.seesNoteCount(1);

    // Give the room every chance to (wrongly) forward something.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(other.notes).toHaveLength(0);

    // The second board's document stayed empty for everybody.
    const lateInRoom2 = await RoomClient.connect(room2);
    expect(lateInRoom2.notes).toHaveLength(0);
    expect(boardState(lateInRoom2)).toBe('[]');

    alex.destroy();
    sam.destroy();
    other.destroy();
    lateInRoom2.destroy();
  });
});

// Extra coverage for the TC-15 error path, checked through the Worker entry.
describe('a rude client cannot poison the room', () => {
  it('keeps the room usable after a socket is closed for bad data', async () => {
    const boardId = freshBoardId();

    // A client that sends a frame the protocol cannot decode.
    const rude = await RoomClient.connect(boardId, { silent: true });
    rude.sendBytes(new Uint8Array([255, 1, 2, 3]));
    await rude.waitForClose();

    // The room survived: it still upgrades, syncs and relays for good clients.
    const alice = await RoomClient.connect(boardId);
    const bob = await RoomClient.connect(boardId);

    createSticky(alice.doc, { x: 1, y: 2 });
    await bob.seesNoteCount(1);
    expect(alice.notes).toHaveLength(1);

    alice.destroy();
    bob.destroy();
  });
});
