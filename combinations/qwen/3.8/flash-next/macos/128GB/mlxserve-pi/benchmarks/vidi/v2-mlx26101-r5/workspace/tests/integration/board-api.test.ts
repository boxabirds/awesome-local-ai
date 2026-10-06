/**
 * The board API: creating a board, asking whether a link is one, and what a connection to a
 * link that is not one gets.
 *
 * Everything here goes through the real Worker (`SELF.fetch`, the Worker's own service
 * binding), the real Durable Object, real RPC between them and real SQLite inside that object.
 * The existence rule and the promise that goes with it — *a question about a link leaves no
 * board behind* — are facts about storage and about request handling, and the only honest way
 * to assert them is to ask the thing that would have written the row.
 *
 * The one thing that is not real is the failure: TC-12 hands the Worker a namespace whose
 * `initialize()` throws, because nothing in this environment can be made to fail an RPC on
 * schedule, and `share.create_failure` is about what the Worker does when one fails.
 *
 *   TC-05  POST /api/boards creates a board, and the board says so afterwards
 *   TC-06  a link that belongs to nobody is a 404, and is still a link that belongs to nobody
 *   TC-07  a link that is not a link is a 404 that never reaches a board
 *   TC-08  a board that was here before links existed is a board
 *   TC-09  a WebSocket to a board that does not exist is refused before it is accepted
 *   TC-10  a WebSocket to a board that does exist is the room from story 3
 *   TC-12  a creation that the Durable Object refuses is a 500, in words
 *   TC-14  a method that is not the one this path takes is a 405
 *   TC-15  a board is created once: the second call says "exists" and changes nothing
 *   TC-32  the page that carries a board's link does not hand that link to anybody
 */

import { describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';

import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { SYNC_STEP_1, decodeMessage } from '../../src/shared/protocol';
import { CREATED_AT_KEY, SCHEMA_VERSION_KEY } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import worker, { type Env } from '../../src/worker/index';
import { retroBoard } from '../fixtures/boards';
import { RoomSocket, WsClient } from './helpers/ws-client';
import { inRoom } from './helpers/room-control';

/** One frame, as far as this file cares: which message, and which sync step. */
function describeFrame(frame: Uint8Array): { kind: string; subType?: number } {
  const buffer = new Uint8Array(frame.byteLength);
  buffer.set(frame);
  const message = decodeMessage(buffer.buffer);
  if (message.kind !== 'sync') return { kind: message.kind };
  const payload = message.payload;
  return {
    kind: message.kind,
    subType: payload.length > 0 ? Number(payload[0]) : undefined,
  };
}

/** The origin the tests address the Worker by. */
const ORIGIN = 'https://vidi6.test';

/** A request to the Worker, as a client sends it. */
function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

/** The JSON body of a response, or an empty object when there was none. */
async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

/** POST /api/boards, the way the home page does it. */
function createBoardRequest(): Promise<Response> {
  return SELF.fetch(request('/api/boards', { method: 'POST' }));
}

/** Creates a board and returns its id, for the tests that need a board to exist. */
async function createBoard(): Promise<string> {
  const response = await createBoardRequest();
  const body = await bodyOf(response);
  const id = body['id'];
  if (response.status !== 201 || typeof id !== 'string') {
    throw new Error(`board creation failed: ${String(response.status)} ${JSON.stringify(body)}`);
  }
  return id;
}

/** The table names this board's storage would have if it had any. */
const TABLE_NAMES = ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates'];

/** The table names a board has, from its own `sqlite_master`. */
function tablesOf(boardId: string): Promise<string[]> {
  return inRoom(boardId, (_room, store) => {
    const names: string[] = [];
    for (const row of store.sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )) {
      names.push(row.name);
    }
    return names;
  });
}

/** The tables of a board that has never been created are not there. */
function boardTablesOf(boardId: string): Promise<string[]> {
  return tablesOf(boardId).then((names) => names.filter((name) => TABLE_NAMES.includes(name)));
}

/** What a board's `created_at` says, or null when it has no such record. */
function createdAtOf(boardId: string): Promise<string | null> {
  return inRoom(boardId, (_room, store) => store.createdAt());
}

/** One row of a board's `storage_meta`, read from inside that board's room. */
function metaOf(boardId: string, key: string): Promise<string | null> {
  return inRoom(boardId, (_room, store) => {
    for (const row of store.sql.exec<{ value: string }>(
      'SELECT value FROM storage_meta WHERE key = ?1',
      key,
    )) {
      return row.value;
    }
    return null;
  });
}

/** Binds a namespace that answers nothing, but records every call. */
function spiedRooms(stub: Partial<Record<'initialize' | 'exists', () => unknown>> = {}) {
  const idFromName = vi.fn((name: string) => `room-${name}` as unknown as DurableObjectId);
  const methods: Record<string, unknown> = {
    initialize: async () => 'created' as const,
    exists: async () => false,
    fetch: async () => new Response('the room', { status: 418 }),
    ...stub,
  };
  const objectStub = methods as unknown as DurableObjectStub<BoardRoom>;
  const get = vi.fn(() => objectStub);
  const env = {
    BOARD_ROOM: { idFromName, get } as unknown as Env['BOARD_ROOM'],
    ASSETS: {
      fetch: async () => new Response('the client', { status: 200 }),
    } as unknown as Env['ASSETS'],
  } satisfies Env;
  return { env, idFromName, get, methods };
}

describe('POST /api/boards creates a board (TC-05)', () => {
  it('answers 201 with an id, the id is a board id, and the board knows it exists', async () => {
    const response = await createBoardRequest();
    const body = await bodyOf(response);

    expect(response.status).toBe(201);
    expect(typeof body['id']).toBe('string');
    const id = body['id'] as string;
    expect(BOARD_ID_PATTERN.test(id), 'the new link is a link').toBe(true);
    expect(isValidBoardId(id)).toBe(true);

    const check = await SELF.fetch(request(`/api/boards/${id}`));
    expect(check.status).toBe(200);
    expect(await bodyOf(check)).toEqual({ id });

    const created = await createdAtOf(id);
    expect(created, 'the board keeps a record of having been created').not.toBeNull();
    expect(Number(created)).toBeGreaterThan(0);
  });

  it('writes the board it was asked for and nothing else', async () => {
    const id = await createBoard();

    const tables = await boardTablesOf(id);
    expect(tables).toEqual(expect.arrayContaining(TABLE_NAMES));
    expect(
      await inRoom(id, (_room, store) => store.pendingRows),
      'a new board has no changes on it',
    ).toBe(0);
    expect(
      (await inRoom(id, (_room, store) => store.snapshotInfo())).chunks,
      'and no snapshot',
    ).toBe(0);
  });

  it('creates boards that have nothing in common with each other', async () => {
    const ids = await Promise.all([createBoard(), createBoard(), createBoard()]);

    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(await createdAtOf(id)).not.toBeNull();
  });
});

describe('GET /api/boards/:id asks a question and does not answer it by making a board', () => {
  it('a link nobody has ever used is a 404, and is still unused afterwards (TC-06)', async () => {
    const id = newBoardId();

    const response = await SELF.fetch(request(`/api/boards/${id}`));

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toMatchObject({ error: 'not_found' });
    // The negative half, and the half that matters: asking left nothing behind. A store that
    // still migrated on construct would have four tables in here.
    expect(await boardTablesOf(id), 'probing a link creates a board').toEqual([]);
  });

  it('an id that is not an id is a 404, and never names a board at all (TC-07)', async () => {
    const malformed = ['abc', 'a'.repeat(23), 'a'.repeat(21), 'has spaces', 'api/rooms'];

    for (const id of malformed) {
      const { env: fake, idFromName, get } = spiedRooms();
      const response = await worker.fetch(request(`/api/boards/${id}`), fake);

      expect(response.status, `${id} is not a board id`).toBe(404);
      expect(await bodyOf(response)).toMatchObject({ error: 'not_found' });
      // No namespace call at all: not an id, not an object, so no RPC to anyone.
      expect(idFromName, `${id} was turned into a Durable Object id`).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    }

    // And the real Worker agrees with the fake one about the two the PRD names.
    expect((await SELF.fetch(request('/api/boards/abc'))).status).toBe(404);
    expect((await SELF.fetch(request(`/api/boards/${'a'.repeat(23)}`))).status).toBe(404);
  });

  it('does not tell a stranger which of the two it could not find (TC-07)', async () => {
    const malformed = await SELF.fetch(request('/api/boards/abc'));
    const unknown = await SELF.fetch(request(`/api/boards/${newBoardId()}`));

    expect([malformed.status, unknown.status]).toEqual([404, 404]);
    expect((await bodyOf(malformed))['error']).toBe((await bodyOf(unknown))['error']);
  });

  it('a board that was here before links were invented is a board (TC-08)', async () => {
    const id = newBoardId();
    // What such a board is: real changes, and no `created_at`, because nothing had written
    // that column's name yet the year these were made.
    await inRoom(id, (_room, store) => {
      store.migrate();
      for (const update of retroBoard().updates) store.append(update);
    });
    expect(await createdAtOf(id), 'the fixture is a board with no creation record').toBeNull();

    const response = await SELF.fetch(request(`/api/boards/${id}`));

    expect(response.status, 'a board with content on it is a board').toBe(200);
    expect(await bodyOf(response)).toEqual({ id });
  });

  it('a board that only has a snapshot is a board too (TC-08)', async () => {
    const id = newBoardId();
    await inRoom(id, (_room, store) => {
      store.migrate();
      store.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?1)',
        new Uint8Array([1, 2, 3]).buffer,
      );
    });

    expect((await SELF.fetch(request(`/api/boards/${id}`))).status).toBe(200);
  });

  it('answers the question without creating anything, on a board and on a non-board alike (TC-06)', async () => {
    const id = await createBoard();
    const before = await tablesOf(id);
    const never = newBoardId();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await SELF.fetch(request(`/api/boards/${id}`))).status).toBe(200);
      expect((await SELF.fetch(request(`/api/boards/${never}`))).status).toBe(404);
    }

    expect(await tablesOf(id), 'asking about a board does not add to it').toEqual(before);
    expect(await boardTablesOf(never)).toEqual([]);
  });

  it('the wrong method on either path is a 405 (TC-14)', async () => {
    const id = newBoardId();

    const put = await SELF.fetch(request('/api/boards', { method: 'PUT', body: '{}' }));
    const del = await SELF.fetch(request('/api/boards', { method: 'DELETE' }));
    const get = await SELF.fetch(request('/api/boards'));
    const patch = await SELF.fetch(request(`/api/boards/${id}`, { method: 'PATCH', body: '{}' }));

    for (const response of [put, del, get, patch]) {
      expect(response.status).toBe(405);
      expect(await bodyOf(response)).toMatchObject({
        error: 'method_not_allowed',
      });
    }
  });

  it('a creation the Durable Object refuses is a 500 in words the client can use (TC-12)', async () => {
    const { env: fake } = spiedRooms({
      initialize: () => {
        throw new Error('the room is not answering');
      },
    });

    const response = await worker.fetch(request('/api/boards', { method: 'POST' }), fake);

    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toMatchObject({ error: 'create_failed' });
  });

  it('a creation that finds the id already taken is a 500 as well, and does not retry', async () => {
    const { env: fake, get } = spiedRooms({
      initialize: async () => 'exists' as const,
    });

    const response = await worker.fetch(request('/api/boards', { method: 'POST' }), fake);

    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toMatchObject({ error: 'create_failed' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a board is created once: the second call says it exists and leaves the record alone (TC-15)', async () => {
    const id = newBoardId();

    const first = await inRoom(id, (room) => room.initialize());
    const written = await createdAtOf(id);
    const second = await inRoom(id, (room) => room.initialize());

    expect(first).toBe('created');
    expect(second).toBe('exists');
    expect(await createdAtOf(id), 'a board that exists is never re-created').toBe(written);
    expect(
      await metaOf(id, SCHEMA_VERSION_KEY),
      'the board was set up, not merely noticed',
    ).not.toBeNull();
    expect(await createdAtOf(id)).toBe(written);
    expect(CREATED_AT_KEY).toBe('created_at');
  });
});

describe('a WebSocket to a board is answered by whether that board exists', () => {
  /** The upgrade headers a browser sends. */
  const UPGRADE = { Upgrade: 'websocket', Connection: 'Upgrade' };

  it('a board that does not exist is refused with 404, no socket and no storage (TC-09)', async () => {
    const id = newBoardId();

    const response = await SELF.fetch(request(`/api/rooms/${id}`, { headers: UPGRADE }));

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toMatchObject({ error: 'not_found' });
    expect(
      response.webSocket,
      'no connection was accepted to a board that is not there',
    ).toBeFalsy();
    await expect(boardTablesOf(id)).resolves.toEqual([]);
  });

  it('an id that is not an id is refused too, and never names a board (TC-07)', async () => {
    const { env: fake, idFromName, get } = spiedRooms();

    const response = await worker.fetch(
      request('/api/rooms/not-a-board-id', { headers: UPGRADE }),
      fake,
    );

    expect(response.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('a board that does exist gets the room story 3 built (TC-10)', async () => {
    const id = await createBoard();

    const socket = await RoomSocket.connect(id);

    expect(socket.isOpen).toBe(true);
    // The room opens the conversation the way story 3 taught it to: a sync step 1, asking
    // this connection what it has.
    expect(describeFrame(await socket.nextFrame())).toEqual({
      kind: 'sync',
      subType: SYNC_STEP_1,
    });
    socket.close();
    // How it ends is the runtime's business — this socket was closed without giving a reason, and
    // which code a socket with no reason reports varies. What is worth asserting is that the room
    // noticed, and that nothing about the way it ended was an error we caused.
    await socket.closed();
    expect(socket.isClosed).toBe(true);
  });

  it('and two people on it share a board, because that is what a room is (TC-10)', async () => {
    const id = await createBoard();
    const first = await WsClient.connect(id);
    const second = await WsClient.connect(id);

    first.transact((doc) => {
      createSticky(doc, { x: 10, y: 20 });
    });
    await first.settle();
    await second.settle();
    await second.waitForSync();

    expect(snapshot(first.doc)).toHaveLength(1);
    expect(snapshot(second.doc)).toHaveLength(1);
    expect(
      await inRoom(id, (_room, store) => store.pendingRows),
      'and it was written down on the way',
    ).toBeGreaterThan(0);
    first.disconnect();
    second.disconnect();
  });

  it('a board created by connecting to it is a story that has ended (TC-09)', async () => {
    // Story 3 let any address become a board by being connected to. That is the exact
    // behaviour `share.not_found` replaces, so it is asserted rather than assumed: the same
    // sequence — connect, then ask — now ends in a refusal and an empty `sqlite_master`.
    const id = newBoardId();

    const upgraded = await SELF.fetch(request(`/api/rooms/${id}`, { headers: UPGRADE }));
    const asked = await SELF.fetch(request(`/api/boards/${id}`));

    expect(upgraded.status).toBe(404);
    expect(asked.status).toBe(404);
    expect(await boardTablesOf(id)).toEqual([]);
    upgraded.webSocket?.close();
  });

  it('a legacy board is still reachable over a WebSocket (TC-08, TC-10)', async () => {
    const id = newBoardId();
    await inRoom(id, (_room, store) => {
      store.migrate();
      for (const update of retroBoard().updates) store.append(update);
    });

    const socket = await RoomSocket.connect(id);
    expect(socket.isOpen).toBe(true);
    expect(describeFrame(await socket.nextFrame())).toEqual({
      kind: 'sync',
      subType: SYNC_STEP_1,
    });
    socket.close();
  });
});

describe('the page that carries a board link keeps it to itself (TC-32)', () => {
  it('served index.html says no-referrer', async () => {
    const response = await SELF.fetch(request('/'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });

  it('and so does the page served at a board address, which is the same page', async () => {
    const id = await createBoard();

    const response = await SELF.fetch(request(`/b/${id}`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
