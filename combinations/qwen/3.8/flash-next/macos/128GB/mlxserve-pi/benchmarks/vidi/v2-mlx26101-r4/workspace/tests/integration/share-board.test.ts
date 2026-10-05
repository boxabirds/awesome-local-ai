/**
 * Integration tests for the board API (share.board_api).
 *
 * These run inside workerd, against the Worker, the Durable Object RPC and the SQLite storage the
 * product ships. What they hold the API to is one claim with three parts: a board is made by
 * asking for one, a link can be asked whether it leads somewhere, and asking costs nothing.
 *
 * The third part is the one that decides the shape of the implementation, and it is what most of
 * these tests are about. A board's link is its only access control, which means strangers will
 * type near-misses of real links, and a lookup that created a board — or even a table — in reply
 * would be a product that fills itself with boards nobody owns. So the negative tests here do not
 * stop at the status code: they open the storage of the board that was looked for and read
 * `sqlite_master`.
 *
 * Two things are deliberately *not* simulated. Boards are made by `POST /api/boards`, the way the
 * home page makes them, so no test is ever connected to a board that does not exist; and the
 * damage in TC-12 is put on the far side of the call that creates a board, which is the only place
 * a real "the room would not answer" can happen.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import {
  checkBoard,
  close,
  converge,
  createBoard,
  createNote,
  fetchBoard,
  fetchPath,
  leave,
  noteById,
  onlyNote,
  request,
  settle,
  upgradeHeaders,
  connect,
  type BoardClient,
} from './helpers/ws-client';
import { callInternal, inRoom, storedNotes } from './helpers/storage';
import type { BoardRoom } from '../../src/worker/board-room';

/** The tables a board's storage is made of, in the order the store creates them. */
const ALL_TABLES = ['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates'];

/** What a room answered to `initialize()`. */
async function callInitialize(boardId: string): Promise<'created' | 'exists'> {
  return inRoom(boardId, (room) => room.initialize());
}

/** Which of the board's tables are on disk. */
function tablesOf(boardId: string): Promise<string[]> {
  return inRoom(boardId, (room) => room.store.tablesPresent());
}

/** The row that says a board exists, or nothing. Nothing here is created to look for it. */
function createdAtOf(boardId: string): Promise<string | null> {
  return inRoom(boardId, (room) =>
    room.store.tablesPresent().length === 0 ? null : room.store.meta('created_at'),
  );
}

/** Ask the Worker for a board the way a browser would, with no body and no identity. */
function post(path = '/api/boards', init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(request(path, init));
}

describe('creating a board (TC-05, TC-14, TC-15)', () => {
  it('creates a board, and the id it hands back is a board afterwards (TC-05)', async () => {
    const id = await createBoard();

    // The id is the address: it is the shape the rest of the product is allowed to open, and it
    // came from nowhere but the Worker.
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);

    const check = await checkBoard(id);
    expect(check.status).toBe(200);
    expect(check.body).toEqual({ id });

    // What makes it a board is one row in that board's own storage. There is no list of boards
    // anywhere in this product, so this row is the whole of its existence.
    expect(await createdAtOf(id)).not.toBeNull();
  });

  it('creates boards that have nothing to do with each other', async () => {
    const first = await createBoard();
    const second = await createBoard();

    expect(first).not.toBe(second);
    const alex = await connect(first);
    const sam = await connect(second);
    try {
      const note = createNote(alex);
      await settle();
      expect(noteById(sam, note)).toBeUndefined();
      expect(sam.snapshot()).toHaveLength(0);
    } finally {
      leave(alex, sam);
    }
  });

  it('refuses every method on the collection that is not POST (TC-14)', async () => {
    // There is no list of boards to read and nothing to change about the collection: a board is
    // made, or it is found by its link. The four that are not POST all get the answer that says
    // this address does not do that.
    for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) {
      const response = await post('/api/boards', { method });
      expect(`${method}: ${response.status}`).toBe(`${method}: 405`);
      await response.text();
    }

    // And on one board: nothing about a board is edited through the API, because a board's
    // contents travel over its connection and not through this door.
    const id = await createBoard();
    const put = await post(`/api/boards/${id}`, { method: 'PUT' });
    expect(put.status).toBe(405);
    await put.text();
  });

  it('does not make a board twice, and does not change the one it has (TC-15)', async () => {
    // This is what a double-click on New board, or a browser resending the request, arrives as:
    // the second call is told the board is already there, and the board it found is untouched.
    const id = newBoardId();

    expect(await callInitialize(id)).toBe('created');
    const created = await createdAtOf(id);
    expect(created).not.toBeNull();

    expect(await callInitialize(id)).toBe('exists');
    expect(await createdAtOf(id)).toBe(created);

    // A board that "already exists" is not a board that was reset: it still holds what was put on
    // it before the second call.
    const client = await connect(id);
    try {
      createNote(client);
      await settle();
    } finally {
      client.close();
    }
    expect(await callInitialize(id)).toBe('exists');
    expect(await storedNotes(id)).toHaveLength(1);
    expect(await createdAtOf(id)).toBe(created);
  });

  it('answers 500 when the room cannot be told the board exists (TC-12)', async () => {
    // The failure is put on the far side of the call that makes a board, which is the only place
    // "the room would not answer" happens for real: the Worker drew an id, named the room that id
    // means, and the room refused to say the board exists.
    const real = env.BOARD_ROOM.get.bind(env.BOARD_ROOM);
    const spy = vi.spyOn(env.BOARD_ROOM, 'get').mockImplementation(
      (id: DurableObjectId) =>
        new Proxy(real(id), {
          get: (target, key) => {
            if (key === 'initialize') {
              return () => {
                throw new Error('injected: the room would not make a board');
              };
            }
            return Reflect.get(target, key);
          },
        }) as ReturnType<DurableObjectNamespace<BoardRoom>['get']>,
    );

    try {
      const response = await post('/api/boards', { method: 'POST' });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'create_failed' });
    } finally {
      spy.mockRestore();
    }

    // The reason the answer is "try again" rather than an apology is that trying again works: the
    // failure left nothing behind, and the next request makes a board like any other.
    const recovered = await post('/api/boards', { method: 'POST' });
    expect(recovered.status).toBe(201);
    const { id } = (await recovered.json()) as { id: string };
    expect((await checkBoard(id)).status).toBe(200);
  }, 10_000);
});

describe('looking a board up (TC-06, TC-07, TC-08)', () => {
  it('says there is no board at a well-formed address that was never created, and writes nothing (TC-06)', async () => {
    const id = newBoardId();

    const check = await checkBoard(id);
    expect(check.status).toBe(404);
    expect(check.body).toEqual({ error: 'not_found' });

    // The interesting half. Answering this needed the room object for the address, so the object
    // exists — but a board does not, and looking for one must not be the thing that makes one. No
    // tables at all: not an empty log, not a metadata row, nothing.
    expect(await tablesOf(id)).toEqual([]);
    expect(await createdAtOf(id)).toBeNull();
  });

  it('says there is no board at an address that is not an address, without asking anywhere (TC-07)', async () => {
    // The namespace is the thing that would name a room, so counting it is how the test knows the
    // Worker answered from the address alone. A stranger can only learn "that is not a link" from
    // an id like `abc`, and cannot be allowed to tell the difference between a mistyped link and
    // somebody else's real one — which is why these two 404s are the same 404.
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    try {
      for (const id of ['abc', 'a'.repeat(23), 'a'.repeat(21), 'bad!id', '', '..%2fx']) {
        const response = await post(`/api/boards/${encodeURIComponent(id)}`);
        expect(`${id}: ${response.status}`).toBe(`${id}: 404`);
        expect(await response.json()).toEqual({ error: 'not_found' });
      }
      expect(idFromName).not.toHaveBeenCalled();
    } finally {
      idFromName.mockRestore();
    }

    // A 23-character id is the boundary that matters here: it is a real link with one character
    // added, and it is refused without a room being named, exactly like the nonsense above.
  });

  it('counts a board that has content and no created row as existing (TC-08)', async () => {
    // A board written before there was a `created_at` row — and there were such boards — has
    // notes in its log and nothing in its metadata. It is a board: the person with its link is
    // not the one who lost the metadata row, and telling them there is no board there would be
    // telling them their notes are gone.
    const id = newBoardId();
    const seeded = await callInternal<{ seeded: number }>(id, 'seed', '?notes=3');
    expect(seeded.seeded).toBe(3);

    // Legacy on purpose: content, and no created row to point at.
    expect(await createdAtOf(id)).toBeNull();
    expect((await tablesOf(id)).length).toBeGreaterThan(0);

    const check = await checkBoard(id);
    expect(check.status).toBe(200);
    expect(check.body).toEqual({ id });
  });

  it('does not make a board by looking for one', async () => {
    // The case `created_at` exists to separate, because it is the case that used to be real:
    // tables are what an object makes for itself when it needs them, so tables alone say nothing
    // about whether anybody ever asked for this board. Here they are made by hand — the call that
    // used to run in the room's constructor, and is now the one that makes a board — and the
    // board is still not there.
    const id = newBoardId();
    expect(await tablesOf(id)).toEqual([]);

    const tables = await inRoom(id, (room) => {
      room.store.migrate();
      return room.store.tablesPresent();
    });
    expect(tables).toEqual(ALL_TABLES);
    expect(await createdAtOf(id)).toBeNull();

    // Empty tables are not a board. The address stays as unknown as it was, however often it is
    // asked, and asking still writes nothing.
    expect((await checkBoard(id)).status).toBe(404);
    expect((await checkBoard(id)).status).toBe(404);
    expect(await createdAtOf(id)).toBeNull();
  });
});

describe('connecting to a board by link (TC-09, TC-10)', () => {
  it('refuses a connection to a link that leads nowhere, and writes nothing (TC-09)', async () => {
    const id = newBoardId();

    const response = await fetchBoard(id, { headers: upgradeHeaders() });
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();
    // No socket: not one that was accepted and then closed, which is what story 3 does for a
    // board it could not read. A link with no board behind it never becomes a connection at all,
    // so there is nothing for a client to misread as an empty board.
    expect(await tablesOf(id)).toEqual([]);

    // A request that is not asking to become a connection is answered by the Worker without even
    // naming a room (story 3's 426), so nothing but a connection can open this address.
    const plain = await fetchBoard(id);
    expect(plain.status).toBe(426);
    await plain.text();
    expect(await tablesOf(id)).toEqual([]);
  });

  it('refuses a malformed link the same way, without naming a room (TC-09, boundary)', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    try {
      for (const id of ['abc', 'a'.repeat(23), 'a'.repeat(21), 'bad!id']) {
        const response = await fetchBoard(encodeURIComponent(id), { headers: upgradeHeaders() });
        expect(`${id}: ${response.status}`).toBe(`${id}: 404`);
        expect(response.webSocket ?? null).toBeNull();
        await response.text();
      }
      expect(idFromName).not.toHaveBeenCalled();
    } finally {
      idFromName.mockRestore();
    }
  });

  it('accepts a connection to a board that was just created, and syncs over it (TC-10)', async () => {
    // The whole point of the API: the same POST that gave back a link is what makes that link
    // open. Everything story 3 does — the handshake, the notes, the two people — has to work
    // unchanged on the other side of it.
    const id = await createBoard();
    const response = await fetchBoard(id, { headers: upgradeHeaders() });
    expect(response.status).toBe(101);
    const first = response.webSocket;
    if (!first) throw new Error(`a new board's own link did not open: ${response.status}`);

    // The socket the Worker accepted is a board connection like any other: it is handed to a
    // client, and two more clients join it and agree with it.
    const clients: BoardClient[] = [];
    try {
      clients.push(await connect(id));
      clients.push(await connect(id));
      const note = createNote(clients[0] as BoardClient, { x: 40, y: 80 });
      await converge(clients);
      expect(onlyNote(clients[1] as BoardClient).id).toBe(note);
    } finally {
      leave(...clients);
      // The socket this test took from the upgrade itself, never handed to a client.
      close(first);
    }
  }, 15_000);
});

describe('what the served page says about itself (TC-32)', () => {
  it('asks browsers not to pass the board address on', async () => {
    // The page at a board address is the same page at every address, and it carries one line that
    // matters only there: a board's link is its access control, so the app asks that the address
    // not be repeated to anybody a person clicks through to.
    const response = await fetchPath(`/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    // Written as HTML, however it is built: the attribute pair is the promise, and a build that
    // closes the tag its own way is not a build that stopped making the request.
    expect(html).toMatch(/<meta[^>]+name="referrer"[^>]+content="no-referrer"/);
    expect(html).toContain('id="root"');
  });
});
