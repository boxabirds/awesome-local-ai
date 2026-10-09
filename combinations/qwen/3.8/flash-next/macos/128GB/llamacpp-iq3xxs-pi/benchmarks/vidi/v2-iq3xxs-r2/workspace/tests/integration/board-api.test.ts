import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { BoardRoom } from '../../src/worker/board-room';
import { META_CREATED_AT, BoardStore } from '../../src/worker/board-store';
import { createBoard } from '../../src/worker/create-board';
import { retroBoard } from '../fixtures/boards';
import { connectClients, disconnectClients, TestClient } from './helpers/ws-client';

/**
 * The board API (`share.board_api`) against the real Worker, real Durable Object RPC and
 * real SQLite: the HTTP contract, the existence rule, and — what the whole story rests
 * on — that asking whether a board exists never writes anything (TC-06, TC-09).
 */

/** Ask the Worker itself, exactly as a browser or a chat app would. */
function get(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://vc.test${path}`, init);
}

function postBoards(): Promise<Response> {
  return get('/api/boards', { method: 'POST' });
}

/** A POST whose body is the whole point. */
async function createBoardOverHttp(): Promise<{ status: number; id: string | null }> {
  const response = await postBoards();
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  return { status: response.status, id: typeof body?.id === 'string' ? body.id : null };
}

const UPGRADE_HEADERS = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

/** A board's room object, without creating the board. */
function roomStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Every table this board's storage holds — the "nothing was written" measurement. */
function tablesOf(boardId: string): Promise<string[]> {
  return runInDurableObject(roomStub(boardId), (_instance, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => row.name),
  );
}

/** `created_at` as it stands in storage, or null when it was never written. */
function createdAtOf(boardId: string): Promise<string | null> {
  return runInDurableObject(roomStub(boardId), (_instance, state) => {
    const row = state.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', META_CREATED_AT)
      .next();
    return row.done === true ? null : row.value.value;
  });
}

describe('POST /api/boards (TC-05, TC-12, TC-14, TC-15)', () => {
  it('TC-05 creates a board: 201 with a well-formed id that then exists, with created_at written', async () => {
    const created = await createBoardOverHttp();
    expect(created.status).toBe(201);
    const boardId = created.id;
    if (!boardId) throw new Error('201 carried no id');
    expect(BOARD_ID_PATTERN.test(boardId)).toBe(true);
    expect(isValidBoardId(boardId)).toBe(true);

    // The board exists, by the same rule the rest of the system uses.
    const checked = await get(`/api/boards/${boardId}`);
    expect(checked.status).toBe(200);
    expect(await checked.json()).toEqual({ id: boardId });

    // `created_at` is there, in epoch milliseconds, and is the only thing written (design:
    // "`created_at` epoch ms, written once per board").
    const createdAt = await createdAtOf(boardId);
    expect(createdAt).not.toBeNull();
    expect(Number.isFinite(Number(createdAt))).toBe(true);
    expect(Number(createdAt)).toBeGreaterThan(1_500_000_000_000);
    expect(await tablesOf(boardId)).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
    );
  });

  it('TC-05: 20 created boards all get distinct, well-formed links (10,000 in the unit suite, TC-04)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const created = await createBoardOverHttp();
      expect(created.status).toBe(201);
      if (!created.id) throw new Error('201 carried no id');
      expect(BOARD_ID_PATTERN.test(created.id)).toBe(true);
      ids.push(created.id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('TC-14 refuses other methods on /api/boards with 405', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const response = await get('/api/boards', { method });
      expect(response.status, `/api/boards with ${method}`).toBe(405);
    }
    expect((await get('/api/boards', { method: 'PUT' })).headers.get('Allow')).toBe('POST');
  });

  it('TC-12 turns an initialize() that throws into 500 create_failed, naming no board', async () => {
    // A real RPC failure cannot be produced on demand, so it is injected at the one place
    // the design names (mock-vs-real table, "RPC failure: injected throwing stub"): the
    // `initialize()` call itself.
    expect(await createBoard(env, throwingNamespace())).toEqual({
      ok: false,
      reason: 'create_failed',
    });

    // And the same failure through the Worker's own door: a 500 that says only
    // `create_failed`, and gives out nothing an id could be mistaken for. The namespace
    // is the injected stub here — the same RPC boundary, the same thrown call.
    const response = await withFailingRpc(postBoards);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-12: an id that turns out to be taken fails rather than adopts the other board', async () => {
    const created = await createBoardOverHttp();
    if (!created.id) throw new Error('setup: no board');
    const before = await createdAtOf(created.id);

    // A namespace that answers `exists` for whatever id it is handed is a collision.
    expect(await createBoard(env, takenNamespace())).toEqual({
      ok: false,
      reason: 'create_failed',
    });

    // The board that was already there is untouched by the attempt.
    expect(await createdAtOf(created.id)).toBe(before);
    expect(await roomStub(created.id).exists()).toBe(true);
  });

  it('TC-15 initialize() twice says created then exists, and created_at does not move', async () => {
    const boardId = newBoardId();
    const stub = roomStub(boardId);
    expect(await stub.initialize()).toBe('created');
    const first = await createdAtOf(boardId);
    expect(first).not.toBeNull();

    expect(await stub.initialize()).toBe('exists');
    expect(await stub.initialize()).toBe('exists');
    // The second and third calls changed nothing: not the timestamp, not the board.
    expect(await createdAtOf(boardId)).toBe(first);
    expect(await stub.exists()).toBe(true);
  });
});

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  it('TC-06 answers 404 for a well-formed id nobody created, and writes nothing while asking', async () => {
    const boardId = newBoardId();
    const response = await get(`/api/boards/${boardId}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // Nothing was written while asking: the storage still holds no tables at all.
    expect(await tablesOf(boardId)).toEqual([]);
    // And asking did not create anything: the board is still not there.
    expect((await get(`/api/boards/${boardId}`)).status).toBe(404);
    expect(await roomStub(boardId).exists()).toBe(false);
  });

  it('TC-07 answers 404 for malformed ids and never reaches the Durable Object', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const valid = newBoardId();
    for (const path of [
      '/api/boards/abc',
      `/api/boards/${valid}a`, // 23 characters
      `/api/boards/${valid.slice(0, 21)}`, // 21 characters
      '/api/boards/%2E%2E%2F%2E%2E', // percent-encoded dots: still not an id
      '/api/boards/%2Fadmin',
      '/api/boards/',
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('TC-14: a wrong verb on a real board address is 405, not an existence check', async () => {
    const created = await createBoardOverHttp();
    if (!created.id) throw new Error('setup: no board');
    const response = await get(`/api/boards/${created.id}`, { method: 'PUT' });
    expect(response.status).toBe(405);
  });

  it('TC-08 counts a board that only has saved content as existing (share.legacy_boards)', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    // Real Yjs updates in `updates`, no `created_at` anywhere: a board from before links.
    await runInDurableObject(roomStub(boardId), (_instance, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of board.updates) store.append(update);
    });
    expect(await createdAtOf(boardId)).toBeNull();
    expect(await roomStub(boardId).exists()).toBe(true);

    const response = await get(`/api/boards/${boardId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: boardId });
  });

  it('TC-08: a board with a snapshot chunk and no log row exists too', async () => {
    const boardId = newBoardId();
    await runInDurableObject(roomStub(boardId), (_instance, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      // A snapshot the compaction of a board long gone could have left behind.
      state.storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        0,
        new Uint8Array(Y.encodeStateAsUpdate(retroBoard().doc)),
      );
    });
    expect(await createdAtOf(boardId)).toBeNull();
    expect(await roomStub(boardId).exists()).toBe(true);
    expect((await get(`/api/boards/${boardId}`)).status).toBe(200);
  });

  it('TC-06: a board whose tables exist but holds nothing and was never created does not exist', async () => {
    // The honest edge of the rule: empty is not the same as created, and this board has
    // neither — so it is treated as not there, and nothing of it is served.
    const boardId = newBoardId();
    await runInDurableObject(roomStub(boardId), (_instance, state) => {
      new BoardStore(state.storage).migrate();
    });
    expect(await roomStub(boardId).exists()).toBe(false);
    expect((await get(`/api/boards/${boardId}`)).status).toBe(404);
  });
});

describe('the WebSocket route (TC-09, TC-10)', () => {
  it('TC-09 refuses an upgrade to a board nobody created, accepting nothing and writing nothing', async () => {
    const boardId = newBoardId();
    const response = await get(`/api/rooms/${boardId}`, { headers: UPGRADE_HEADERS });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
    expect(await tablesOf(boardId)).toEqual([]);

    // A client that tries anyway is refused the same way it would be over HTTP.
    await expect(TestClient.connect(boardId, { create: false })).rejects.toThrow(/404/);
    expect(await tablesOf(boardId)).toEqual([]);
  });

  it('TC-09: a malformed board address is refused before any object is asked', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const response = await get('/api/rooms/not-a-board-id', { headers: UPGRADE_HEADERS });
    expect(response.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('TC-09: a board that exists still answers 426 to a request that does not upgrade', async () => {
    const created = await createBoardOverHttp();
    if (!created.id) throw new Error('setup: no board');
    expect((await get(`/api/rooms/${created.id}`)).status).toBe(426);
  });

  it('TC-10 upgrades a board created by POST and syncs two clients on it', async () => {
    const created = await createBoardOverHttp();
    if (!created.id) throw new Error('setup: no board');
    const boardId = created.id;

    const response = await get(`/api/rooms/${boardId}`, { headers: UPGRADE_HEADERS });
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close();

    // Story 3's sync is unchanged on a board created this way.
    const [a, b] = await connectClients(boardId, 2);
    try {
      initDoc(a.doc);
      createSticky(a.doc, { x: 40, y: 20 });
      await b.waitUntil('the note the other client made', () => b.notes().length === 1);
      expect(b.notes()).toEqual(a.notes());
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-09: probing a board does not make it exist; creating it does', async () => {
    const boardId = newBoardId();
    expect((await get(`/api/boards/${boardId}`)).status).toBe(404);
    expect((await get(`/api/rooms/${boardId}`, { headers: UPGRADE_HEADERS })).status).toBe(404);
    expect(await roomStub(boardId).exists()).toBe(false);
    expect(await roomStub(boardId).initialize()).toBe('created');
    expect((await get(`/api/boards/${boardId}`)).status).toBe(200);
  });
});

describe('the client build the Worker serves (TC-32)', () => {
  it('TC-32: index.html carries the no-referrer privacy rule on every route', async () => {
    for (const path of ['/', '/b/abc', '/anything']) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect(
        html.includes('<meta name="referrer" content="no-referrer"'),
        `${path} should carry the referrer meta`,
      ).toBe(true);
    }
  });
});

/* --------------------------------------------------------------------------- */

/** A namespace whose `initialize()` always throws: an RPC that cannot be reached. */
function throwingNamespace(): DurableObjectNamespace<BoardRoom> {
  return {
    idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
    get: () => ({
      initialize: async () => {
        throw new Error('injected RPC failure');
      },
    }),
  } as unknown as DurableObjectNamespace<BoardRoom>;
}

/**
 * Run `run` while `env.BOARD_ROOM.get()` hands back a stub whose `initialize()` throws —
 * the injected stub of the design's mock-vs-real table, in front of the real Worker
 * handler, so the HTTP answer to a broken RPC is measured rather than described.
 */
async function withFailingRpc<T>(run: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(env.BOARD_ROOM, 'get').mockImplementation(
    () =>
      ({
        initialize: async () => {
          throw new Error('injected RPC failure');
        },
      }) as unknown as ReturnType<typeof env.BOARD_ROOM.get>,
  );
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

/** A namespace that answers `exists` for whatever id it is handed: a collision. */
function takenNamespace(): DurableObjectNamespace<BoardRoom> {
  return {
    idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
    get: () => ({ initialize: async () => 'exists' as const }),
  } as unknown as DurableObjectNamespace<BoardRoom>;
}
