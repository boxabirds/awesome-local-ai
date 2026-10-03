// share.board_api + share.not_found integration tests (TC-05 … TC-10, TC-12,
// TC-14, TC-15, TC-32), run against the real Worker and the real Durable Object
// SQLite through `SELF.fetch`.
//
// The two rules these tests hold the server to:
//  - A board comes into existence only through POST /api/boards, which writes the
//    table layout and a one-time `created_at` stamp (share.board_api).
//  - Asking about a board never creates one: an unknown or malformed link is answered
//    404 without a table, a row, a board id or a stack trace (share.not_found,
//    TC-32).

import { describe, expect, it } from 'vitest';
import { SELF, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { createSticky } from '../../src/shared/board-model';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { RoomClient } from './helpers/ws-client';
import {
  bindings,
  createRoom,
  liveRoomIds,
  roomSnapshot,
  roomStub,
  waitForRoom,
} from './helpers/room';

const BOARDS = 'https://example.com/api/boards';
const UPGRADE = { headers: { Upgrade: 'websocket' } };

/** POST /api/boards and return the status plus the parsed body. */
async function postNewBoard(): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
}> {
  const response = await SELF.fetch(BOARDS, { method: 'POST' });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body, text };
}

/** GET /api/boards/:id and return the status plus the parsed body. */
async function getBoard(id: string): Promise<{ status: number; text: string }> {
  const response = await SELF.fetch(`${BOARDS}/${id}`);
  return { status: response.status, text: await response.text() };
}

/** The table layout this board's storage actually holds, read inside the object. */
async function tablesOf(boardId: string): Promise<string[]> {
  return runInDurableObject(roomStub(boardId), (_instance, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => String(row.name))
      // workerd keeps its own bookkeeping tables; only ours matter here.
      .filter((name) =>
        ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates'].includes(
          name,
        ),
      ),
  );
}

/** `created_at` as stored, read inside the object. */
async function createdAtOf(boardId: string): Promise<string | null> {
  return runInDurableObject(roomStub(boardId), (instance: BoardRoom) =>
    (instance as unknown as { store: BoardStore }).store.createdAt(),
  );
}

describe('creating a board (TC-05, TC-08, TC-10, TC-15)', () => {
  it('TC-08 returns 201 with only the new id in the body', async () => {
    const { status, body, text } = await postNewBoard();
    expect(status).toBe(201);
    expect(typeof body.id).toBe('string');
    expect(isValidBoardId(String(body.id))).toBe(true);
    // Nothing else in the body: the answer is the id and nothing more.
    expect(Object.keys(body).sort()).toEqual(['id']);
    expect(text).toBe(JSON.stringify({ id: body.id }));
  });

  it('TC-05 creating twice gives two different boards, both usable', async () => {
    const first = await postNewBoard();
    const second = await postNewBoard();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const idA = String(first.body.id);
    const idB = String(second.body.id);
    expect(idA).not.toBe(idB);

    for (const id of [idA, idB]) {
      expect((await getBoard(id)).status).toBe(200);
    }

    // Both are joinable, and each is its own room: a note on one is never on the
    // other (live.isolation through the same door).
    const a = await RoomClient.connect(idA);
    const b = await RoomClient.connect(idB);
    await a.waitForSync();
    await b.waitForSync();
    createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    await a.waitForDoc((notes) => notes.length === 1, 'a has its note');
    await waitForRoom(idA, (notes) => notes.length === 1, 'room A stored it');
    // The other board is a different room and a different object: it has nothing.
    // (Deep cross-board isolation is worker.test.ts TC-17; here we only need the two
    // links to be two boards.)
    expect(b.snapshot()).toEqual([]);
    expect(await roomSnapshot(idB)).toEqual([]);
    a.close();
    b.close();
  });

  it('TC-10 fifty created boards all exist, with distinct ids and objects', async () => {
    const created = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const { status, body } = await postNewBoard();
        expect(status).toBe(201);
        return String(body.id);
      }),
    );
    expect(new Set(created).size).toBe(50);

    const live = await liveRoomIds();
    for (const id of created) {
      expect((await getBoard(id)).status).toBe(200);
      // Each link addressed its own Durable Object: the object id the namespace
      // derives from this board id is distinct per board and is one of the live ones.
      const objectId = namespace.idFromName(id).toString();
      expect(live.filter((liveId) => liveId === objectId)).toHaveLength(1);
    }
    expect(
      new Set(created.map((id) => namespace.idFromName(id).toString())).size,
    ).toBe(50);
  });

  it('TC-15 initializing the same board twice creates it once', async () => {
    const id = newBoardId();
    const room = roomStub(id);
    expect(await room.initialize()).toBe('created');
    const first = await createdAtOf(id);
    expect(first).not.toBeNull();

    // A second create does not reset the board or hand out a second creation stamp.
    expect(await room.initialize()).toBe('exists');
    expect(await createdAtOf(id)).toBe(first);
    expect(await tablesOf(id)).toEqual(
      expect.arrayContaining(['storage_meta', 'updates']),
    );
    expect(await runInDurableObject(room, (_instance, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]!.n,
    )).toBe(0);
  });

  it('rejects a method other than POST on the collection with 405', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const response = await SELF.fetch(BOARDS, { method });
      expect([response.status, method]).toEqual([405, method]);
    }
  });
});

describe('an unknown link is not found, and creates nothing (TC-06, TC-07, TC-09)', () => {
  it('TC-06 GET on an unknown board answers 404 and leaves no tables', async () => {
    const id = newBoardId();
    const response = await getBoard(id);
    expect(response.status).toBe(404);
    // Answering the question must not set up the board it was asked about.
    expect(await tablesOf(id)).toEqual([]);
  });

  it('TC-07 a malformed id is 404 without instantiating anything', async () => {
    const malformed = ['', 'abc', 'a'.repeat(23), 'a'.repeat(21), 'bad/id', 'bad%2fid'];
    const before = await liveRoomIds();
    for (const raw of malformed) {
      const response = await SELF.fetch(`${BOARDS}/${raw}`);
      expect([response.status, raw]).toEqual([404, raw]);
    }
    // No Durable Object was reached for any of them: the id list is untouched, which
    // is the observable form of "the RPC was never called".
    expect(await liveRoomIds()).toEqual(before);
  });

  it('TC-09 probing a hundred unknown boards stores nothing', async () => {
    const ids = Array.from({ length: 100 }, () => newBoardId());
    for (const id of ids) {
      expect((await getBoard(id)).status).toBe(404);
    }
    // Nothing was written for any of them, and no board appeared: not a table, not a
    // row, and no *board* was created by the probing.
    for (const id of ids) {
      expect(await tablesOf(id)).toEqual([]);
    }
    const created = await SELF.fetch(BOARDS, { method: 'POST' });
    const newId = String((await created.json() as { id: string }).id);
    expect(ids).not.toContain(newId);
    expect(await tablesOf(newId)).not.toEqual([]);
  });

  it('TC-14 an unknown board refuses the WebSocket upgrade with 404', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`https://example.com/api/rooms/${id}`, UPGRADE);
    expect(response.status).toBe(404);
    // No socket was accepted for a board that does not exist.
    expect(
      (response as unknown as { webSocket?: WebSocket | null }).webSocket ?? null,
    ).toBeNull();

    // A request for the rooms route with no id at all is a 404 too: there is no such
    // board, and story 5 does not distinguish that from a bad link.
    const noId = await SELF.fetch('https://example.com/api/rooms/', UPGRADE);
    expect(noId.status).toBe(404);
  });

  it('TC-32 a not-found answer leaks no id, no other board, no stack', async () => {
    // A real board, so its id is something that must never show up elsewhere.
    const real = await postNewBoard();
    const realId = String(real.body.id);

    const unknown = await getBoard(newBoardId());
    expect(unknown.status).toBe(404);
    const malformed = await SELF.fetch(`${BOARDS}/not-an-id`);
    expect(malformed.status).toBe(404);

    for (const body of [unknown.text, await malformed.text()]) {
      expect(body).not.toContain(realId);
      expect(body).not.toContain('at '); // no stack frame
      expect(body.length).toBeLessThan(200);
      expect(JSON.parse(body)).toEqual({ error: 'not_found' });
    }
  });

  it('TC-32 the served page asks for no referrer to be sent', async () => {
    const page = await SELF.fetch('https://example.com/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});

describe('creation failure (TC-12)', () => {
  // The injection point is `BoardStore.markCreated`, the write `initialize()`
  // performs: the route, the RPC and the error shape all stay the real ones, and the
  // failure travels back as the value `initialize()` reports rather than as an
  // exception, which is what makes 500 `create_failed` observable to the client.
  it('TC-12 a create that cannot be written answers 500 create_failed', async () => {
    const original = BoardStore.prototype.markCreated;
    BoardStore.prototype.markCreated = () => {
      throw new Error('injected create failure');
    };
    try {
      const first = await postNewBoard();
      expect(first.status).toBe(500);
      expect(JSON.parse(first.text)).toEqual({ error: 'create_failed' });
      // The client-visible contract: a retryable error, and no half-created board.
      const retry = await postNewBoard();
      expect(retry.status).toBe(500);
      expect(JSON.parse(retry.text)).toEqual({ error: 'create_failed' });
    } finally {
      BoardStore.prototype.markCreated = original;
    }
    // With the failure gone, creation works again.
    expect((await postNewBoard()).status).toBe(201);
  });

  it('TC-12 a board whose create failed is still not found', async () => {
    // Creation failed, so nothing was written: the link a client might retry stays a
    // 404 rather than half-existing (share.not_found's "never created").
    const id = newBoardId();
    const original = BoardStore.prototype.markCreated;
    BoardStore.prototype.markCreated = () => {
      throw new Error('injected create failure');
    };
    try {
      expect(await createRoom(id)).toBe('failed');
    } finally {
      BoardStore.prototype.markCreated = original;
    }
    expect((await getBoard(id)).status).toBe(404);
    expect(await tablesOf(id)).toEqual([]);

    expect(await createRoom(id)).toBe('created');
    expect((await getBoard(id)).status).toBe(200);
  });

  it('TC-12 a create that reports the address taken is refused, not adopted', async () => {
    // The other half of `initialize()`'s answer: a brand-new id that somebody already
    // owns is a failure, never a silent takeover of that board.
    const id = newBoardId();
    expect(await createRoom(id)).toBe('created');
    const original = BoardStore.prototype.markCreated;
    BoardStore.prototype.markCreated = () => 'exists';
    try {
      expect(await roomStub(id).initialize()).toBe('exists');
    } finally {
      BoardStore.prototype.markCreated = original;
    }
    // The board that was already there is untouched.
    expect((await getBoard(id)).status).toBe(200);
  });
});

/** The namespace the Worker's bindings hand to the routes. */
const namespace = bindings.BOARD_ROOM;

/** `listDurableObjectIds` is per-namespace: one link, one object. */
it('the board namespace hands out one id per board', async () => {
  const a = newBoardId();
  const b = newBoardId();
  expect(a).not.toBe(b);
  expect(namespace.idFromName(a).toString()).not.toBe(
    namespace.idFromName(b).toString(),
  );
  expect(await listDurableObjectIds(namespace)).toBeInstanceOf(Array);
});
