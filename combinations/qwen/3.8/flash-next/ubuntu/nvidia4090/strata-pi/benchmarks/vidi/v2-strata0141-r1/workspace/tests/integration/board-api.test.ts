import { describe, it, expect, afterEach } from 'vitest';
import { SELF, abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { BOARD_API_PREFIX, ROOM_ROUTE_PREFIX } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { retroBoard, batchUpdates } from '../fixtures/boards';
import {
  addSticky,
  bindings,
  connectRoom,
  hasRoom,
  initializeBoard,
  newBoardIdFor,
  newUnusedBoardId,
  openClient,
  ProtocolClient,
  roomCount,
  settle,
} from './helpers/room';

/**
 * TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32 (anchor `share.board_api`).
 *
 * Everything runs against the real Worker entry, a real Durable Object, real
 * Durable Object RPC and real SQLite storage, because the two facts this
 * contract depends on cannot be checked any other way:
 *
 *   - a board exists exactly when its own storage says so;
 *   - asking whether a board exists writes nothing (`share.not_found`).
 *
 * The dimension classes (D1 entry, D2 board state, D3 service condition) of each
 * run are named in the test title.
 */

const SELF_ORIGIN = 'http://board.test';

const OPEN: { close(): void }[] = [];

afterEach(async () => {
  for (const thing of OPEN.splice(0)) {
    try {
      thing.close();
    } catch {
      // Already gone.
    }
  }
  // Let every room handler this test started finish before the objects are
  // deleted out from under it. `abortAllDurableObjects` first: a refused WebSocket
  // upgrade (TC-09) leaves the local Durable Object waiting, and deleting it
  // while it waits makes workerd complain.
  await settle(400);
  await abortAllDurableObjects();
  await reset();
});

const keep = <T extends { close(): void }>(thing: T): T => {
  OPEN.push(thing);
  return thing;
};

const roomStub = (boardId: string) => {
  const ns = bindings().BOARD_ROOM;
  return ns.get(ns.idFromName(boardId));
};

const post = (path: string, method = 'POST') =>
  SELF.fetch(`${SELF_ORIGIN}${path}`, { method });

const getJson = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await SELF.fetch(`${SELF_ORIGIN}${path}`);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
};

/** The table names this board's own SQLite holds. */
const tables = async (boardId: string): Promise<string[]> =>
  runInDurableObject(roomStub(boardId), (instance) => instance.testTables());

/** `created_at` as stored for this board. */
const createdAt = async (boardId: string): Promise<number | null> =>
  runInDurableObject(roomStub(boardId), (instance) => instance.testCreatedAt());

const existsRpc = async (boardId: string): Promise<boolean> =>
  runInDurableObject(roomStub(boardId), (instance) => instance.exists());

/* ---------------------------------------------------------------------------
 * TC-05 / TC-14: creating a board
 * ------------------------------------------------------------------------- */

describe('POST /api/boards (share.create, share.unguessable)', () => {
  it('TC-05: creating a board returns 201 with a valid id, and that board exists (D1 home create/D2 unknown valid id/D3 healthy)', async () => {
    const response = await post(`${BOARD_API_PREFIX}`);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(body.id)).toBe(true);

    // The board the API just named is the board the existence check reports.
    const check = await getJson(`${BOARD_API_PREFIX}/${body.id}`);
    expect(check.status).toBe(200);
    expect(check.body.id).toBe(body.id);

    // And its storage carries the creation marker story 5 defines.
    expect(await createdAt(body.id)).toBeTypeOf('number');
    expect(await existsRpc(body.id)).toBe(true);
  });

  it('TC-05: a created board opens empty (D1 home create/D2 empty board)', async () => {
    const response = await post(`${BOARD_API_PREFIX}`);
    const { id } = (await response.json()) as { id: string };
    const client = keep(await openClient(id));
    expect(client.snapshot()).toHaveLength(0);
    expect((await SELF.fetch(`${SELF_ORIGIN}/b/${id}`)).status).toBe(200);
  });

  it('TC-14: a method that is not POST is refused with 405 (error path)', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'GET']) {
      const response = await post(`${BOARD_API_PREFIX}`, method);
      expect(response.status).toBe(405);
    }
  });
});

/* ---------------------------------------------------------------------------
 * TC-06 / TC-07: a link that does not name a board
 * ------------------------------------------------------------------------- */

describe('GET /api/boards/:id (share.not_found, share.legacy_boards)', () => {
  it('TC-06: an unknown valid id is 404 and leaves no storage behind (D2 unknown valid id, negative)', async () => {
    const board = newUnusedBoardId();
    const check = await getJson(`${BOARD_API_PREFIX}/${board}`);
    expect(check.status).toBe(404);
    expect(check.body.error).toBe('not_found');

    // Probing a link must not create a board: this board's SQLite has no tables
    // at all, and nothing was written to any of them.
    expect(await tables(board)).toEqual([]);
    expect(await createdAt(board)).toBeNull();
    expect(await existsRpc(board)).toBe(false);
  });

  it('TC-07: a malformed id is 404 and never reaches a Durable Object (D2 malformed id, negative)', async () => {
    const roomsBefore = await roomCount();
    const malformed = ['abc', 'x'.repeat(23), 'a'.repeat(21), 'a'.repeat(11)];
    for (const id of malformed) {
      const check = await getJson(`${BOARD_API_PREFIX}/${id}`);
      expect(check.status).toBe(404);
      expect(check.body.error).toBe('not_found');
      // No RPC call was made, so no object was created for it either.
      expect(await hasRoom(id)).toBe(false);
    }
    expect(await roomCount()).toBe(roomsBefore);
  });

  it('TC-08: a board with stored content but no creation marker still exists (D2 legacy, share.legacy_boards)', async () => {
    const board = newBoardIdFor('legacy');
    // Story 4 rows only: content, and no `created_at` anywhere.
    const fixture = retroBoard();
    // Base64 text, the shape every path into a Durable Object uses: a method
    // call handed bytes hands over an object the other isolate cannot copy.
    const fixtureUpdates = batchUpdates(fixture.updates, 3).map((update) =>
      Buffer.from(update).toString('base64'),
    );
    const rows = await runInDurableObject(roomStub(board), (instance) =>
      instance.testSeedLegacy(fixtureUpdates),
    );
    expect(rows).toBe(fixtureUpdates.length);
    expect(await createdAt(board)).toBeNull();

    const check = await getJson(`${BOARD_API_PREFIX}/${board}`);
    expect(check.status).toBe(200);
    expect(check.body.id).toBe(board);
    expect(await existsRpc(board)).toBe(true);

    // And it opens as the board it holds, not as an empty one.
    const client = keep(await openClient(board));
    expect(client.snapshot().length).toBe(fixture.notes.length);
  });
});

/* ---------------------------------------------------------------------------
 * TC-09 / TC-10: the live route refuses unknown boards
 * ------------------------------------------------------------------------- */

describe('/api/rooms/:id (share.not_found, share.open_link)', () => {
  it('TC-09: an upgrade to an unknown board is 404, with no socket and no storage (D2 unknown valid id, negative)', async () => {
    const board = newUnusedBoardId();
    const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${board}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-version': '13' },
    });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
    expect(await tables(board)).toEqual([]);
  });

  it('TC-09: a malformed id on the live route is 404 too (D2 malformed id, negative)', async () => {
    const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}not-a-board-id`, {
      headers: { upgrade: 'websocket', 'sec-websocket-version': '13' },
    });
    expect(response.status).toBe(404);
  });

  it('TC-09: an existing board without an Upgrade header is still 426 (D3 healthy)', async () => {
    const board = newBoardIdFor('no426');
    await initializeBoard(board);
    const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${board}`);
    expect(response.status).toBe(426);
  });

  it('TC-10: an upgrade after POST is 101 and the story 3 sync works (D1 WebSocket connect/D2 initialized)', async () => {
    const response = await post(`${BOARD_API_PREFIX}`);
    const { id } = (await response.json()) as { id: string };

    const socket = keep(await connectRoom(id));
    expect(socket.ws).toBeTruthy();

    const client = keep(new ProtocolClient(socket));
    await client.handshake();
    client.edit((doc) => {
      addSticky(doc, 30, 30, 'shared by link');
    });
    await settle(300);

    const notes = await runInDurableObject(roomStub(id), (instance) => instance.inspectDoc());
    expect(notes.map((note) => note.text)).toContain('shared by link');
    expect(snapshot(client.doc).map((note) => note.text)).toContain('shared by link');
  });
});

/* ---------------------------------------------------------------------------
 * TC-12 / TC-15: creation that fails, and creation that must not repeat
 * ------------------------------------------------------------------------- */

describe('board creation failure and re-creation (share.create_failure)', () => {
  it('TC-12: an `initialize()` that throws answers 500 create_failed (D3 RPC failure, error path)', async () => {
    const envBindings = bindings() as unknown as { BOARD_ROOM: unknown };
    const real = bindings().BOARD_ROOM;
    const failingNamespace = {
      idFromName: (name: string) => real.idFromName(name),
      get: () => ({
        initialize: async () => {
          throw new Error('simulated: RPC to the board room failed');
        },
      }),
    };
    envBindings.BOARD_ROOM = failingNamespace;
    try {
      const response = await post(`${BOARD_API_PREFIX}`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('create_failed');
    } finally {
      envBindings.BOARD_ROOM = real;
    }
  });

  it('TC-15: initializing the same board twice never re-initialises it (D2 initialized, negative)', async () => {
    const board = newBoardIdFor('twice');
    expect(await initializeBoard(board)).toBe('created');
    const first = await createdAt(board);
    expect(first).toBeTypeOf('number');

    // A second creation is refused by the room itself, and changes nothing.
    const stub = roomStub(board);
    const second = await runInDurableObject(stub, (instance) => instance.initialize());
    expect(second).toBe('exists');
    expect(await createdAt(board)).toBe(first);

    // The board's own document is untouched too.
    expect(await runInDurableObject(stub, (instance) => instance.inspectDoc())).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
 * TC-32: privacy constraint
 * ------------------------------------------------------------------------- */

describe('served page (privacy constraint)', () => {
  it('TC-32: the served page declares no-referrer, so a board link is never sent as a Referer (negative)', async () => {
    const response = await SELF.fetch(`${SELF_ORIGIN}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
