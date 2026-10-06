/**
 * The board API (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32): `POST /api/boards`,
 * `GET /api/boards/:id`, and what a WebSocket connection to a board that was never
 * created gets.
 *
 * Everything here is real: the real `fetch` handler, the real namespace, the real
 * Durable Object and its real SQLite, driven with `SELF.fetch` and the room's own RPC.
 * Nothing about a board is mocked, because the two things these tests exist to pin
 * down are answered only by real storage: that a board is *made* by one request and by
 * nothing else, and that asking about a board that was never made leaves the storage
 * exactly as it found it.
 *
 * "No RPC call was made" is measured the way `worker.test.ts` measures it — at the
 * thing a spy would only claim: no Durable Object exists for that name.
 *
 * Rooms outlive a single test inside a project run (the Worker instance is shared by
 * the files), so nothing here asserts "these are all the boards"; the assertions about
 * counting are about *this* board's storage, which belongs to this test alone.
 */

import { SELF, env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id.js';
import { createSticky, getStickyText } from '../../src/shared/board-model.js';
import type { BoardRoom } from '../../src/worker/board-room.js';
import { eventually, syncedClient, type Client } from './ws-client.js';

const get = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, init);

const post = (path: string): Promise<Response> => get(path, { method: 'POST' });

/** The rooms that exist, as ids. */
const roomIds = async (): Promise<string[]> =>
  (await listDurableObjectIds(env.BOARD_ROOM)).map((id) => id.toString());

/** The id a board name routes to. */
const idOf = (boardId: string): string => env.BOARD_ROOM.idFromName(boardId).toString();

/**
 * The room's own storage. `ctx` is protected on the class and a test is not a
 * subclass; reading the real rows is the point of these tests, so this is the same
 * reach `board-room-persistence.test.ts` uses.
 */
const storageOf = (room: BoardRoom): DurableObjectStorage =>
  (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;

/** Run `fn` inside the object of a board this test has no interest in. */
const inSomeRoom = <T>(fn: (room: BoardRoom) => T): Promise<T> =>
  runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId())), fn);

/** Does this board's storage have this table? */
const hasTable = (storage: DurableObjectStorage, table: string): boolean =>
  storage.sql
    .exec<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      table,
    )
    .toArray()[0]!.n > 0;

/** The tables this board's storage has, by name. */
const tablesOf = (boardId: string): Promise<string[]> =>
  runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)), (room) =>
    storageOf(room).sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .toArray()
      .map((row) => row.name),
  );

/** Everything in a board's `storage_meta`, as stored; `{}` when there is none. */
const metaOf = (boardId: string): Promise<Record<string, string>> =>
  runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)), (room) => {
    const storage = storageOf(room);
    if (!hasTable(storage, 'storage_meta')) return {};
    return Object.fromEntries(
      storage
        .sql.exec<{ key: string; value: string }>(`SELECT key, value FROM storage_meta`)
        .toArray()
        .map((row) => [row.key, row.value]),
    );
  });

/** Rows of a board's log, counted in its own storage; 0 when it has no log. */
const rowsOf = (boardId: string): Promise<number> =>
  runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)), (room) => {
    const storage = storageOf(room);
    if (!hasTable(storage, 'updates')) return 0;
    return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM updates`).toArray()[0]!.n;
  });

/** The body of an API response, which is always JSON. */
const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

/* ---------------------------------------------------------------------------- the API */

describe('POST /api/boards (TC-05, TC-12, TC-14, TC-15)', () => {
  it('TC-05 makes a board whose link works, and writes it to storage', async () => {
    const response = await post('/api/boards');
    expect(response.status).toBe(201);
    const id = String((await bodyOf(response))['id']);
    expect(BOARD_ID_PATTERN.test(id), `id ${id} is a board id`).toBe(true);

    // The board is there, by the id the API gave out and no other.
    const check = await get(`/api/boards/${id}`);
    expect(check.status).toBe(200);
    expect((await bodyOf(check))['id']).toBe(id);

    // And it is there in storage: `created_at` is what making a board means.
    expect(Number((await metaOf(id))['created_at'])).toBeGreaterThan(0);
    // Nothing else was written for it. An empty board is an empty board: a person who
    // creates one and never edits it must not be shown a board with a note in it, and
    // must not be left with a log row that looks like one.
    expect(await rowsOf(id)).toBe(0);
  });

  it('TC-05 hands out a different board for every press of the button', async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const response = await post('/api/boards');
        expect(response.status).toBe(201);
        return String((await bodyOf(response))['id']);
      }),
    );
    expect(new Set(ids).size).toBe(6);
    // Each is its own object: the isolation between boards is the id.
    expect(new Set(ids.map(idOf)).size).toBe(6);
  });

  it('TC-14 refuses a method that is not the route', async () => {
    const id = newBoardId();
    for (const [method, path] of [
      ['PUT', '/api/boards'],
      ['DELETE', '/api/boards'],
      ['PATCH', '/api/boards'],
      ['GET', '/api/boards'],
      ['POST', `/api/boards/${id}`],
      ['DELETE', `/api/boards/${id}`],
      ['PUT', `/api/boards/${id}`],
    ] as const) {
      const response = await get(path, { method });
      expect(response.status, `${method} ${path}`).toBe(405);
      expect((await bodyOf(response))['error']).toBe('method_not_allowed');
    }
    // A refused method asked no question about a board, so it asked no object either.
    expect(await roomIds()).not.toContain(idOf(id));
  });

  it('TC-15 initialises a board once: the second call says it exists and moves nothing', async () => {
    const id = newBoardId();
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    expect(await room.initialize()).toBe('created');
    const first = await metaOf(id);

    expect(await room.initialize()).toBe('exists');
    // `created_at` is a fact about when a board began, not a timestamp to be refreshed.
    expect(await metaOf(id)).toEqual(first);
    // And being asked twice wrote no rows: an existing board is never re-initialised.
    expect(await rowsOf(id)).toBe(0);

    // A third time, from a different caller, on purpose: this is the call
    // `POST /api/boards` would make if the 128 bits ever repeated.
    expect(await room.initialize()).toBe('exists');
    expect(await metaOf(id)).toEqual(first);
  });

  it('TC-12 says create_failed, and not a board, when the object cannot be initialised', async () => {
    // A real RPC failure cannot be provoked on demand, so the room's own method is
    // made to throw — on the prototype, inside the isolate the room runs in, which is
    // the only reach into it a test has. The room is the thing that had to fail, and
    // the method is put back before this test ends.
    type Initialise = () => Promise<'created' | 'exists'>;
    type Prototype = { initialize: Initialise; realInitialize?: Initialise };

    const patch = (failing: boolean) =>
      inSomeRoom((room) => {
        const proto = Object.getPrototypeOf(room) as Prototype;
        if (failing) {
          proto.realInitialize ??= proto.initialize;
          // Not a throwing function but a property that is not callable at all: that is
          // how an object that does not answer this method presents itself to the RPC
          // layer, and the failure the Worker sees is the runtime's own rather than one
          // this test threw.
          proto.initialize = 'not callable' as unknown as Prototype['initialize'];
        } else if (proto.realInitialize !== undefined) {
          proto.initialize = proto.realInitialize;
        }
        return proto.initialize === proto.realInitialize;
      });

    await patch(true);
    let response: Response;
    try {
      response = await post('/api/boards');
    } finally {
      expect(await patch(false), 'the room can create boards again').toBe(true);
    }

    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body['error']).toBe('create_failed');
    // There is no id in the answer, so there is nothing to hand on as a link: a
    // creation that failed is not a board that exists but was reported badly.
    expect(body['id']).toBeUndefined();

    // And with the room answering again, a creation is a creation.
    expect((await post('/api/boards')).status).toBe(201);
  });
});

/* ----------------------------------------------------------------------- existence */

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  it('TC-06 says a board nobody made is not there, and writes nothing to find out', async () => {
    const id = newBoardId();

    const response = await get(`/api/boards/${id}`);
    expect(response.status).toBe(404);
    expect((await bodyOf(response))['error']).toBe('not_found');

    // The storage of that board has no tables — not an empty `updates`, not a
    // `storage_meta` holding a schema version. A link typed at a board that was never
    // created must not leave anything behind that could be mistaken for a board.
    expect(await tablesOf(id)).toEqual([]);
    expect(await rowsOf(id)).toBe(0);

    // Asking twice is the same as asking once: the answer is read, not produced.
    expect((await get(`/api/boards/${id}`)).status).toBe(404);
    expect(await tablesOf(id)).toEqual([]);
  });

  it('TC-07 refuses a malformed id without asking any object about it', async () => {
    const before = await roomIds();
    const malformed = [
      'abc',
      'a'.repeat(23), // one character too many
      'a'.repeat(21), // and one too few
      'bad!id', // not base64url
      `${'a'.repeat(21)}=`, // padding an unpadded encoding never carries
      `${'a!'.repeat(11)}`, // right length, and `!` is in no base64url alphabet
    ];

    for (const id of malformed) {
      const response = await get(`/api/boards/${id}`);
      expect(response.status, `GET /api/boards/${id}`).toBe(404);
      expect((await bodyOf(response))['error']).toBe('not_found');
    }

    // A path that looks like a board id with a slash in it is one id that is not an
    // id, and gets the same answer without reaching past the route.
    const slashed = await get(`/api/boards/${'a'.repeat(21)}/notes`);
    expect(slashed.status).toBe(404);
    expect((await bodyOf(slashed))['error']).toBe('not_found');

    // None of them woke an object: no Durable Object exists for any of these names,
    // which is the only observable form of "no RPC call was made".
    const after = await roomIds();
    for (const id of malformed) {
      expect(after, `${id} was never looked up`).not.toContain(idOf(id));
    }
    expect(after.length).toBe(before.length);
  });

  it('TC-08 opens a board that was made before there was a creation step', async () => {
    const id = newBoardId();
    const seeded = await SELF.fetch(`http://localhost/__test/boards/${id}/seed-legacy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 3, textLength: 12 }),
    });
    expect(seeded.status).toBe(200);
    expect((await bodyOf(seeded))['added']).toBe(3);

    // The board is rows and no `created_at`, which is what every board in the world
    // looked like the day before this API existed.
    expect((await metaOf(id))['created_at']).toBeUndefined();
    expect(await rowsOf(id)).toBeGreaterThan(0);

    const response = await get(`/api/boards/${id}`);
    expect(response.status).toBe(200);
    expect((await bodyOf(response))['id']).toBe(id);

    // And the room lets people in on it, which is the other half of the promise: an
    // old board must open, not be reported as lost.
    const client = await syncedClient(id);
    expect(client.snapshot()).toHaveLength(3);
    client.close();
  });

  it('TC-06 answers the same way for a board whose object exists but was never created', async () => {
    // The object exists — asking about a board constructs it — and an object holding an
    // empty document is not evidence that a board exists.
    const id = newBoardId();
    expect(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).exists()).toBe(false);
    expect((await get(`/api/boards/${id}`)).status).toBe(404);
    expect(await tablesOf(id)).toEqual([]);
  });
});

/* --------------------------------------------------------------------- joining a board */

describe('joining a board (TC-09, TC-10, TC-32)', () => {
  it('TC-09 turns a connection to a board nobody made away, and accepts no socket', async () => {
    const id = newBoardId();

    const response = await get(`/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();

    // Nothing was written in the asking: no schema, no rows, no `created_at` — so the
    // next person who asks gets the same honest answer, however often they knock.
    expect(await tablesOf(id)).toEqual([]);
    expect(
      (await get(`/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } })).status,
    ).toBe(404);
    expect(await tablesOf(id)).toEqual([]);
  });

  it('TC-09 still answers a request that never asked for an upgrade with a 426', async () => {
    // The 426 comes first: it is a fact about the request, knowable without asking a
    // single object, and a board that does not exist must not be able to turn it off.
    expect((await get(`/api/rooms/${newBoardId()}`)).status).toBe(426);
    expect((await get(`/api/rooms/${'a'.repeat(22)}`)).status).toBe(426);
  });

  it('TC-09 keeps a malformed id out of the room, with the same answer as an unknown one', async () => {
    // Story 3 called this a 400; from the client's side the two are one page.
    const before = await roomIds();
    const response = await get(`/api/rooms/bad!id`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();
    expect(await roomIds()).toEqual(before);
  });

  it('TC-10 joins a board that was created, and syncs on it like any other', async () => {
    const id = String((await bodyOf(await post('/api/boards')))['id']);

    const client: Client = await syncedClient(id);
    expect(client.ws.readyState).toBe(WebSocket.READY_STATE_OPEN);

    const noteId = createSticky(client.doc, { x: 20, y: 30 });
    expect(noteId).not.toBe(false);
    getStickyText(client.doc, noteId as string)?.insert(0, 'shared by link');

    const other = await syncedClient(id);
    await eventually(
      () => {
        const texts = other.snapshot().map((note) => note.text);
        if (texts.length !== 1 || texts[0] !== 'shared by link') {
          throw new Error(`the second screen shows ${JSON.stringify(texts)}`);
        }
      },
      { what: 'the second person to open the link to see the note' },
    );

    // The note is in the rows, so the second person would still see it after the first
    // one's tab is closed: nothing about the share flow keeps a change in memory.
    await eventually(async () => expect(await rowsOf(id)).toBeGreaterThanOrEqual(3), {
      what: 'the note to be in the rows',
    });

    client.close();
    other.close();
  });

  it('TC-32 does not hand the board link to a third party as a Referer', async () => {
    // A board's link is the only thing keeping the board private, so the page must not
    // repeat it to other origins. The promise is made in the document itself.
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const html = await (await get(path)).text();
      expect(
        /<meta\s+name="referrer"\s+content="no-referrer"/.test(html),
        `${path} carries the referrer policy`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ what it does not do */

describe('the board API leaves other things alone', () => {
  it('is not a way to create a board by asking for one', async () => {
    // The whole story in one line: forty questions about forty boards that do not
    // exist, and the storage of every one of them is still empty.
    const ids = Array.from({ length: 40 }, () => newBoardId());
    for (const id of ids) {
      expect((await get(`/api/boards/${id}`)).status).toBe(404);
    }
    const withTables = await Promise.all(ids.map((id) => tablesOf(id)));
    expect(withTables.filter((tables) => tables.length > 0)).toEqual([]);
  });

  it('keeps a created board’s existence independent of who is connected', async () => {
    const id = String((await bodyOf(await post('/api/boards')))['id']);
    const client = await syncedClient(id);
    const meta = await metaOf(id);
    // What the board holds at its quietest moment, which is one row: the connection
    // that brought the client there set the board up, and story 4 wrote that row into
    // storage like any other change.
    const rows = await rowsOf(id);
    client.close();

    await eventually(async () => expect((await get(`/api/boards/${id}`)).status).toBe(200), {
      what: 'the board to be there after everyone has gone',
    });
    // Nobody is on it and it is still the same board: the same birthday, no rows added
    // by anyone leaving, and nobody has to be connected for it to be a board.
    expect(await rowsOf(id)).toBe(rows);
    expect(Number(meta['created_at'])).toBeGreaterThan(0);
    expect(await metaOf(id)).toEqual(meta);
  });
});
