// share.board_api (integration): the board API against the real Worker, real
// Durable Object RPC and real SQLite.
//
// What this file is really checking is one distinction, over and over: the service
// must know the difference between *a board that is not there* and *a board it has
// not been asked about*. The first is an answer the page may repeat to a person
// ("Board not found"); the second is not an answer at all, and must never be given -
// which is why the negative cases here are about storage as much as about status
// codes. Asking whether a board exists may not create it: a link checked by a
// crawler, a chat app's previewer or a mistyped person would otherwise fill the
// service with empty boards that look exactly like the deleted ones.
//
// Two ways of reaching in, both narrow:
//   - `SELF.fetch` for everything a client can do, and
//   - `runInDurableObject` for what only the object's own SQLite can show
//     (`sqlite_master`, `created_at`), plus a hand-made `env` for the RPC failures
//     that cannot be made happen any other way.

import { describe, expect, it } from 'vitest';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import worker, { type Env } from '../../src/worker/index';
import { createBoard } from '../../src/worker/create-board';
import { BoardStore } from '../../src/worker/board-store';
import { BoardRoom } from '../../src/worker/board-room';
import { handleTestHook } from '../../src/worker/test-hooks';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { boardExists, createdBoardId, reloadRoom, stubFor, TestClient } from './helpers/room';

/** The tables this object's SQLite database actually holds. */
function tables(id: string): Promise<string[]> {
  return runInDurableObject(stubFor(id) as never, (_room, state) =>
    [...state.storage.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)].map((row) =>
      String(row.name),
    ),
  );
}

/** The object's `created_at`, or null when it carries no creation stamp. */
function createdAt(id: string): Promise<number | null> {
  return runInDurableObject(stubFor(id) as never, (_room, state) => {
    const sql = state.storage.sql;
    // Read out of the object's own SQLite rather than through the store, so this
    // answers for a board with no tables at all instead of throwing on a table that
    // was never created.
    const stamped = [
      ...sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_meta'`),
    ].length;
    if (stamped === 0) return null;
    for (const row of sql.exec(`SELECT value FROM storage_meta WHERE key = 'created_at'`)) {
      return Number(row.value);
    }
    return null;
  });
}

/** Rows in the update log, read straight out of the object's storage. */
function updateRows(id: string): Promise<number> {
  return runInDurableObject(stubFor(id) as never, (_room, state) => {
    const sql = state.storage.sql;
    if (
      [...sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'updates'`)]
        .length === 0
    ) {
      return 0;
    }
    for (const row of sql.exec(`SELECT COUNT(*) AS n FROM updates`)) return Number(row.n);
    return 0;
  });
}

function post(): Promise<Response> {
  return SELF.fetch('http://localhost/api/boards', { method: 'POST' });
}

function get(id: string): Promise<Response> {
  return SELF.fetch(`http://localhost/api/boards/${id}`);
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/boards (TC-05, TC-12, TC-14, TC-15)', () => {
  it('TC-05 creates a board the service knows about, and says when it made it', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const created = await body(res);
    expect(typeof created.id).toBe('string');
    const id = created.id as string;
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);

    // The link is worth sending because the service now knows this id.
    expect((await get(id)).status).toBe(200);
    expect(await boardExists(id)).toBe(true);

    // `created_at` is what makes it a created board rather than an empty address.
    const stamp = await createdAt(id);
    expect(stamp).not.toBeNull();
    // A real clock reading from this minute, not a placeholder or a zero.
    expect(stamp).toBeGreaterThan(0);
    expect(stamp as number).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - (stamp as number)).toBeLessThan(60_000);

    // Creation writes the stamp and the schema, and no data rows: a new board is
    // empty, which is a different thing from being absent.
    expect(await updateRows(id)).toBe(0);
  });

  it('TC-05 two clicks make two boards, and neither link opens the other', async () => {
    const first = await body(await post());
    const second = await body(await post());
    expect(first.id).not.toBe(second.id);
    expect(await boardExists(first.id as string)).toBe(true);
    expect(await boardExists(second.id as string)).toBe(true);
  });

  it('TC-14 answers a method the collection does not take with 405', async () => {
    const put = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(put.status).toBe(405);
    // It says what it does take, so a wrong verb is a wrong verb and not a mystery.
    expect(put.headers.get('Allow')).toBe('POST');
    expect(await body(put)).toEqual({ error: 'method_not_allowed' });

    const getCollection = await SELF.fetch('http://localhost/api/boards');
    expect(getCollection.status).toBe(405);
    // Negative: a read of the collection is not a list of boards (stories 14-15).
    expect(await body(getCollection)).toEqual({ error: 'method_not_allowed' });

    // And one board's address takes a read, not a write.
    const id = await createdBoardId();
    const written = await SELF.fetch(`http://localhost/api/boards/${id}`, {
      method: 'PUT',
      body: '{}',
    });
    expect(written.status).toBe(405);
    expect(written.headers.get('Allow')).toBe('GET, HEAD');

    // Negative: the refused write changed nothing. The board is still there, still
    // answerable, still with no rows.
    expect((await get(id)).status).toBe(200);
    expect(await updateRows(id)).toBe(0);
  });

  it('TC-15 initialize() once creates, the second time says it was already there', async () => {
    const id = newBoardId();
    const stub = stubFor(id);

    expect(await stub.initialize()).toBe('created');
    const first = await createdAt(id);
    expect(first).not.toBeNull();

    // A second call is not a second creation: no new board, no new stamp. A board
    // that was re-initialised would be a board whose contents were reset.
    expect(await stub.initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(first);
  });

  it('TC-12 answers an creation that the storage could not carry out with 500', async () => {
    // The only way to make an RPC fail on demand: a namespace of our own, whose
    // `initialize` throws the way a Durable Object does when it cannot write.
    const failing = namespace({
      initialize: async () => {
        throw new Error('injected RPC failure');
      },
    });

    const res = await worker.fetch(new Request('http://localhost/api/boards', { method: 'POST' }), {
      BOARD_ROOM: failing,
    } as unknown as Env);

    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'create_failed' });
    // The client's own reading of the same answer.
    expect(await createBoard({ BOARD_ROOM: failing } as unknown as Env)).toEqual({
      ok: false,
      reason: 'create_failed',
    });
  });

  it('TC-12 answers an id that was already taken with 500 rather than handing it over', async () => {
    // A 128-bit collision is not a practical event, but the answer to it is what
    // matters: sending the caller somebody else's board would be worse than
    // refusing to send them a board at all.
    const taken = namespace({ initialize: async () => 'exists' });

    const res = await worker.fetch(new Request('http://localhost/api/boards', { method: 'POST' }), {
      BOARD_ROOM: taken,
    } as unknown as Env);

    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'create_failed' });
    expect(await createBoard({ BOARD_ROOM: taken } as unknown as Env)).toEqual({
      ok: false,
      reason: 'create_failed',
    });
  });

  it('TC-12 a creation that works reports the id it was given', async () => {
    const made = namespace({ initialize: async () => 'created' });
    const result = await createBoard({ BOARD_ROOM: made } as unknown as Env);
    expect(result.ok).toBe(true);
    if (result.ok) expect(BOARD_ID_PATTERN.test(result.id)).toBe(true);
  });
});

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  it('TC-06 says there is no such board, and writes nothing while finding out', async () => {
    const id = newBoardId();

    const res = await get(id);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(await boardExists(id)).toBe(false);

    // The point of the whole check: asking cost nothing. An address that was only
    // looked at has no tables at all - not an empty board, nothing.
    expect(await tables(id)).toEqual([]);
    expect(await createdAt(id)).toBeNull();
  });

  it('TC-06 an empty board is a board: created, no rows, and it answers 200', async () => {
    // The distinction TC-06 depends on. Without it "no rows" and "no board" are the
    // same answer, and every new board would be Board not found until somebody
    // typed into it.
    const id = await createdBoardId();
    expect(await updateRows(id)).toBe(0);
    expect((await get(id)).status).toBe(200);
    expect(await tables(id)).toEqual(expect.arrayContaining(['updates', 'snapshot_chunks', 'storage_meta']));
  });

  it('TC-06 a board whose only trace is a snapshot is a board too', async () => {
    // A board an older build compacted and never stamped: no `created_at`, log folded
    // away into a snapshot. The rows have to answer for it.
    const id = newBoardId();
    await runInDurableObject(stubFor(id) as never, (_room, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 }, 'blue');
      store.append(Y.encodeStateAsUpdate(doc));
      store.compactIfNeeded(doc, { force: true });
    });

    expect((await get(id)).status).toBe(200);
    expect(await createdAt(id)).toBeNull();
    // Negative: the snapshot is what answered, and the log really is empty - so this
    // is not the `updates`-row case again.
    expect(await updateRows(id)).toBe(0);
  });

  it('TC-07 refuses a malformed id without asking the board, so nothing is created', async () => {
    const asked: string[] = [];
    const watching = namespace({
      idFromName: (name: string) => {
        asked.push(name);
        return env.BOARD_ROOM.idFromName(name);
      },
      get: (id: DurableObjectId) => {
        asked.push(`get:${id.toString()}`);
        return stubFor(newBoardId());
      },
    });

    for (const bad of ['abc', 'short', newBoardId().slice(0, 21), `${newBoardId()}x`, 'a'.repeat(23)]) {
      const res = await worker.fetch(new Request(`http://localhost/api/boards/${bad}`), {
        BOARD_ROOM: watching,
      } as unknown as Env);
      expect(res.status).toBe(404);
      expect(await body(res)).toEqual({ error: 'not_found' });
    }

    // Negative: not one name lookup, not one object, so not one write. This is the
    // difference between the id being *rejected as a name* and *asked about*.
    expect(asked).toEqual([]);
  });

  it('TC-07 a malformed id is refused the same way over POST-shaped reads and HEAD', async () => {
    const res = await SELF.fetch('http://localhost/api/boards/abc', { method: 'HEAD' });
    expect(res.status).toBe(404);
  });

  it('TC-08 a board with rows but no creation stamp still opens', async () => {
    // A board that predates this feature: it has a link people are using, and it
    // must keep working rather than be declared missing.
    const id = newBoardId();
    const update = seededUpdate();
    await runInDurableObject(stubFor(id) as never, (_room, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      store.append(update);
    });

    expect((await get(id)).status).toBe(200);
    expect(await boardExists(id)).toBe(true);
    expect(await createdAt(id)).toBeNull();
    // Negative: and the read that found it wrote nothing new.
    expect(await updateRows(id)).toBe(1);
  });

  it('TC-08 a legacy board still takes a socket, and shows what is on it', async () => {
    const id = newBoardId();
    await runInDurableObject(stubFor(id) as never, (_room, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 12, y: 34 }, 'green');
      store.append(Y.encodeStateAsUpdate(doc));
    });

    // The object was woken by the seeding call itself, so its document was read
    // before the row existed. This is the wake that reads it back - the same one an
    // idle object gets when the next person arrives.
    await reloadRoom(id);

    const client = await TestClient.connect(id);
    await client.waitForSync();
    // What is being asserted is that a board with no creation stamp is served rather
    // than refused, and served with what is on it.
    expect(client.snapshot().length).toBe(1);
    expect(client.snapshot()[0]?.color).toBe('green');
    client.close();
  });
});

describe('the room refuses to be a board that was never created (TC-09, TC-10)', () => {
  it('TC-09 turns a socket up to an unknown board away, and stays unwritten', async () => {
    const id = newBoardId();

    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });

    expect(res.status).toBe(404);
    // No socket on the answer, in either shape the runtime uses for "none".
    expect((res as unknown as { webSocket?: WebSocket | null }).webSocket ?? null).toBeNull();
    expect(await roomSocketCount(id)).toBe(0);

    // Negative: being connected to is not what makes a board exist. Had this
    // accepted, every mistyped link would have produced a real, empty, findable
    // board - the exact confusion the not-found page exists to prevent.
    expect(await tables(id)).toEqual([]);
    expect(await boardExists(id)).toBe(false);
  });

  it('TC-10 opens the socket of a board the API created, and syncs it', async () => {
    const id = (await body(await post())).id as string;

    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    (res as unknown as { webSocket: WebSocket }).webSocket.accept();

    // The board behind a created link behaves like any other board: two people on it
    // see each other's notes.
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    createSticky(a.doc, { x: 5, y: 5 }, 'pink');
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot()[0]?.color).toBe('pink');

    // And what they made is stored, so the third person to arrive sees it too.
    const c = await TestClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot().length).toBe(1);

    a.close();
    b.close();
    c.close();
  });
});

describe('TC-32 the board page does not hand its link to third parties', () => {
  it('serves a page that asks for no referrer', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    // The link is the only access control, so the board page must not send it onward
    // as a Referer when a person follows something out of the page.
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/>?/);
  });
});

describe('the seed-legacy hook (TC-06)', () => {
  /**
   * Run the seeding hook on a room, with the target the room's own `fetch` would
   * hand it. The hook is normally reached only when `TEST_HOOKS` is on, which is a
   * deployment switch the integration environment does not set; the code under test
   * here is the hook's, so it is called with a target made the same way the room
   * makes one, against the same real SQLite.
   */
  const seed = async (id: string, updates?: string[]) => {
    const res = await runInDurableObject(
      stubFor(id) as unknown as DurableObjectStub<BoardRoom>,
      (room, state) =>
        handleTestHook(
          {
            enabled: true,
            storage: state.storage,
            store: new BoardStore(state.storage),
            doc: () => null,
            reload: () => room.loadNow(),
            diagnostics: () => room.diagnostics(),
          },
          new Request('http://room/__test/seed-legacy', {
            method: 'POST',
            body: JSON.stringify({ updates }),
          }),
        ),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('TC-06 makes a board out of rows alone, and will not remake a created one', async () => {
    // The only honest way to test that a board predating links is still a board:
    // rows and no creation stamp, which is what a build before this story left
    // behind. The hook refuses to do this to a board that was created, so a test
    // cannot pass on a shape the product never produces.
    const id = newBoardId();
    const update = toBase64(seededUpdate());
    expect((await seed(id, [update])).status).toBe(200);

    expect((await get(id)).status).toBe(200);
    expect(await createdAt(id)).toBeNull();
    expect(await boardExists(id)).toBe(true);

    const created = await createdBoardId();
    expect((await seed(created, [update])).status).toBe(409);
    expect(await createdAt(created)).not.toBeNull();

    // And a seed with nothing to seed does not quietly make a board exist.
    const empty = newBoardId();
    expect((await seed(empty, [])).status).toBe(400);
    expect((await get(empty)).status).toBe(404);
  });
});

/** Bytes as the base64 the seeding hook takes its updates in. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** One update containing one note, from a document that is not the room's. */
function seededUpdate(): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);
  createSticky(doc, { x: 1, y: 1 }, 'yellow');
  return Y.encodeStateAsUpdate(doc);
}

/** Rooms the tests know about, for socket counting. */
async function roomSocketCount(id: string): Promise<number> {
  return runInDurableObject(stubFor(id) as never, (_room, state) => state.getWebSockets().length);
}

/**
 * A Durable Object namespace that answers the two RPCs the board API makes, however
 * the test asks. Only `BOARD_ROOM` is needed: the board routes touch nothing else.
 */
function namespace(
  behaviour: {
    idFromName?: (name: string) => DurableObjectId;
    get?: (id: DurableObjectId) => DurableObjectStub;
    initialize?: () => Promise<'created' | 'exists'>;
    exists?: () => Promise<boolean>;
  },
): DurableObjectNamespace {
  const stub = {
    initialize: behaviour.initialize ?? (async () => 'created' as const),
    exists: behaviour.exists ?? (async () => true),
  };
  return {
    idFromName:
      behaviour.idFromName ?? ((name: string) => env.BOARD_ROOM.idFromName(`injected-${name}`)),
    get: behaviour.get ?? ((): DurableObjectStub => stub as unknown as DurableObjectStub),
    newUniqueId: () => {
      throw new Error('not used by the board API');
    },
  } as unknown as DurableObjectNamespace;
}
