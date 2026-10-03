/**
 * The board API, in the real runtime: `POST /api/boards`, `GET /api/boards/:id`, and
 * the WebSocket route's refusal of addresses that are not boards.
 *
 * Everything here is a fact about *existence*, and existence is a storage fact, so
 * nothing is mocked: requests go through `SELF.fetch` into the same handler a browser
 * hits, the RPC reaches a real `BoardRoom`, and the answers are checked against that
 * object's own SQLite.
 *
 * The two claims that matter most are the negative ones. A made-up link must not create
 * a board (TC-06, TC-09): a stranger trying addresses must not be able to leave one
 * behind, and a person with a typo must not find themselves the author of a blank board
 * they think is their colleagues' work. And a malformed id must not reach an object at
 * all (TC-07): the check is `isValidBoardId`, before the namespace is touched.
 *
 * The fixture boards come from `tests/fixtures/boards.ts`, so the "legacy" board in
 * TC-08 is made of the same bytes the app writes — content saved at an address with no
 * `created_at` row to point at it, which is what a board from before this feature was.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import { retroBoard } from '../fixtures/boards';

import { connectRoom, type RoomClient } from './helpers/room-client';

const ORIGIN = 'https://board.test';

interface CreatedBody {
  id?: string;
  error?: string;
}

/** `POST /api/boards`, as the home page calls it. */
async function postBoard(): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST' });
}

/** `GET /api/boards/:id`, as the board page calls it. */
async function getBoard(boardId: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${boardId}`);
}

/** An upgrade request for a board's room. */
async function upgrade(boardId: string): Promise<Response> {
  return SELF.fetch(new Request(`${ORIGIN}/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } }));
}

/** Look inside the board's own storage. Only plain data comes back out of the object. */
async function inStorage<T>(boardId: string, read: (storage: DurableObjectStorage) => T): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room) =>
    read((room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage),
  );
}

/** Every user table the board's database has. Empty means nothing was ever written. */
function tableNames(storage: DurableObjectStorage): string[] {
  return (
    storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray() as { name: string }[]
  ).map((row) => row.name);
}

function createdAt(storage: DurableObjectStorage): number | null {
  const rows = storage.sql
    .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
    .toArray() as { value: string }[];
  const stored = rows[0]?.value;
  return stored === undefined ? null : Number(stored);
}

function updateRows(storage: DurableObjectStorage): number {
  if (!tableNames(storage).includes('updates')) return 0;
  return storage.sql.exec('SELECT COUNT(*) AS count FROM updates').one().count as number;
}

/** Call the room's RPC directly, the way `createBoard` and the existence check do. */
async function rpc<T>(
  boardId: string,
  call: 'initialize' | 'exists',
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as unknown as {
    initialize(): Promise<T>;
    exists(): Promise<T>;
  };
  return call === 'initialize' ? stub.initialize() : stub.exists();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/boards (TC-05, TC-12, TC-14, TC-15)', () => {
  it('creates a board whose address the client can use (TC-05)', async () => {
    // One id generated, one object asked, no retry loop (design §2.2): a retry here would
    // be the bug that makes a shared link point at somebody else's board.
    const derived = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const response = await postBoard();
    expect(derived).toHaveBeenCalledTimes(1);
    derived.mockRestore();
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreatedBody;
    expect(body.id).toMatch(BOARD_ID_PATTERN);
    const boardId = body.id ?? '';
    expect(isValidBoardId(boardId)).toBe(true);

    // The address is a board: the page's check says so, and the reason is the row the
    // existence rule reads.
    expect((await getBoard(boardId)).status).toBe(200);
    const created = await inStorage(boardId, createdAt);
    expect(created).not.toBeNull();
    expect(created).toBeGreaterThan(0);
    // A board is created empty. Everything else in it arrives through a socket.
    expect(await inStorage(boardId, updateRows)).toBe(0);
  });

  it('answers 500 create_failed when the call to the room fails, and creates nothing (TC-12)', async () => {
    // A real RPC failure cannot be arranged on demand, so this is the one injected error.
    // It is injected at the namespace rather than inside the object because a rejection
    // raised inside a durable object call does not survive this test runtime's RPC layer
    // cleanly; what is being tested is on the near side of that boundary — that any
    // failure to reach `initialize` is reported as a failure and never as a board.
    const boardIds: string[] = [];
    vi.spyOn(env.BOARD_ROOM, 'get').mockImplementation((id: DurableObjectId) => {
      boardIds.push(id.toString());
      throw new Error('rpc is down');
    });
    const response = await postBoard();
    vi.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });
    // The failure happened while reaching the room, so nothing was written anywhere:
    // there is no board at the address that was tried.
    expect(boardIds).toHaveLength(1);

    // And the failure is not sticky: the next creation works.
    const after = await postBoard();
    expect(after.status).toBe(201);
  });

  it('refuses a method the path does not take with 405 (TC-14)', async () => {
    const put = await SELF.fetch(`${ORIGIN}/api/boards`, { method: 'PUT' });
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('POST');

    for (const method of ['DELETE', 'PATCH']) {
      const response = await SELF.fetch(`${ORIGIN}/api/boards`, { method });
      expect(response.status, method).toBe(405);
    }
    // A wrong method on a board address is refused the same way, and says what it takes.
    const wrong = await SELF.fetch(`${ORIGIN}/api/boards/${newBoardId()}`, { method: 'PUT' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
  });

  it('initializes an address once and never again (TC-15)', async () => {
    const boardId = newBoardId();
    expect(await rpc<'created' | 'exists'>(boardId, 'initialize')).toBe('created');
    const first = await inStorage(boardId, createdAt);
    expect(first).not.toBeNull();

    // A second call reports the board that exists rather than making a new one, and the
    // first timestamp is left alone: "created" is a fact about the board, not about the
    // call that looked at it.
    expect(await rpc<'created' | 'exists'>(boardId, 'initialize')).toBe('exists');
    expect(await inStorage(boardId, createdAt)).toBe(first);
    expect(await rpc<boolean>(boardId, 'exists')).toBe(true);
  });
});

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  it('answers 404 for a well-formed address nobody created, and writes nothing (TC-06)', async () => {
    const boardId = newBoardId();
    const response = await getBoard(boardId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // The negative half of the requirement: looking at an address must not make a board.
    // A stranger trying codes would otherwise be able to fill storage, and a person
    // with a mistyped link would be leaving boards behind them.
    const tables = await inStorage(boardId, tableNames);
    expect(tables).toEqual([]);
  });

  it('answers 404 for a malformed address without reaching an object (TC-07)', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    for (const bad of ['abc', 'a'.repeat(21), 'a'.repeat(23), 'not%20an%20id', 'a'.repeat(22) + '/extra']) {
      const response = await getBoard(bad);
      expect(response.status, bad).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('counts content saved before created_at existed as an existing board (TC-08)', async () => {
    // The legacy shape (prd `share.legacy_boards`): real updates from the fixture, in the
    // log, and no `created_at` row anywhere.
    const board = retroBoard();
    const boardId = board.boardId;
    const rows = await inStorage(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      for (const update of board.updates) store.append(update);
      return updateRows(storage);
    });
    expect(rows).toBeGreaterThan(0);
    expect(await inStorage(boardId, createdAt)).toBeNull();

    const response = await getBoard(boardId);
    expect(response.status).toBe(200);
    expect((await response.json()) as CreatedBody).toEqual({ id: boardId });

    // And looking at it changed nothing about it: still no `created_at`.
    expect(await inStorage(boardId, createdAt)).toBeNull();
  });

  it('says the same 404 for "not valid" and "not made", so nothing is leaked', async () => {
    const malformed = await getBoard('abc');
    const unknown = await getBoard(newBoardId());
    expect(malformed.status).toBe(unknown.status);
    expect(await malformed.json()).toEqual(await unknown.json());
  });
});

describe('the WebSocket route (TC-09, TC-10)', () => {
  it('refuses a well-formed address that is not a board, without writing (TC-09)', async () => {
    const boardId = newBoardId();
    const response = await upgrade(boardId);
    expect(response.status).toBe(404);
    // Nothing to accept: a 404 with a socket in it would be a board someone could join.
    expect(response.webSocket).toBeNull();
    expect(await inStorage(boardId, tableNames)).toEqual([]);
  });

  it('accepts a board that was created, and syncs it as story 3 does (TC-10)', async () => {
    const response = await postBoard();
    const boardId = ((await response.json()) as CreatedBody).id ?? '';
    const opened = await upgrade(boardId);
    expect(opened.status).toBe(101);
    const socket = opened.webSocket;
    expect(socket).toBeInstanceOf(WebSocket);
    if (socket) {
      socket.accept();
      socket.close(1000, 'done');
    }

    // And the room behind it is a working board: a client joins, writes, and the write
    // is in the room that served it.
    const client: RoomClient = await connectRoom(boardId);
    try {
      const id = createSticky(client.doc, { x: 20, y: 30 });
      await client.waitForNotes(1);
      expect(client.notes()[0]?.id).toBe(id);
      expect(await inStorage(boardId, updateRows)).toBeGreaterThan(0);
    } finally {
      client.destroy();
    }
  });
});

describe('privacy of the served page (TC-32)', () => {
  it('serves the client with no-referrer, so a board link leaves the page no other way', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    // One `meta` element carrying both attributes. Written in the source as `/>`; what
    // matters is the pair the browser parses, not how the bundler serialised it.
    expect(html).toMatch(/<meta[^>]*name="referrer"[^>]*content="no-referrer"[^>]*>/);
  });
});
