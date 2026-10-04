import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { SELF, runInDurableObject } from 'cloudflare:test';
import worker, { type Env } from '../../src/worker/index';
import { createBoard } from '../../src/worker/create-board';
import type { BoardRoom } from '../../src/worker/board-room';
import { notesOf, updateOfNote } from '../fixtures/boards';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createLegacyBoard, legacyNotesIn, type LegacyNote } from '../../src/worker/test-hooks';
import {
  boardId,
  boardStub,
  countRows,
  insideBoard,
  openRoom,
  selectRows,
  selectText,
} from './helpers/storage';
import { env } from './helpers/ws-client';

/**
 * Story 5: a board is made, and a link says whether it leads somewhere.
 *
 * These are the two calls the client is given, run through the Worker's real `fetch` handler
 * against real Durable Objects: `POST /api/boards` and `GET /api/boards/:id`. What is worth testing
 * is not that a JSON body arrives - it is what each answer is made *of*, because that answer is the
 * only thing telling a person whether a board exists:
 *
 * - a created board is a board: the id is random, the object behind it has storage, and the same
 *   question asked twice gives the same answer (TC-05, TC-15);
 * - a board that is not there stays not there: asking writes nothing, so a hundred links tried at
 *   random leave a hundred empty addresses rather than a hundred boards (TC-06, TC-07);
 * - the answer never distinguishes "never made" from "not a link code", because the difference is
 *   information about which links are real (TC-07);
 * - and a board made the old way, with a log and no creation date, is still a board (TC-08).
 *
 * Whether a *connection* to a board that is not there is refused is story 3's file's business, and
 * lives in `board-room.test.ts`.
 */

/** The creation date a board was given, or null when it has none. */
function createdAt(name: string): Promise<string | null> {
  return selectText(boardStub(name), 'SELECT value FROM storage_meta WHERE key = ?', 'created_at');
}

/** The tables this board's storage holds, asked inside the object, reading only. */
function tablesIn(name: string): Promise<string[]> {
  return runInDurableObject(boardStub(name), (_room, state) => {
    const names: string[] = [];
    for (const row of state.storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )) {
      names.push(String(row['name']));
    }
    return names;
  });
}

/** `POST /api/boards`, or any other method at either of the two board addresses. */
function ask(path: string, method = 'POST'): Promise<Response> {
  return SELF.fetch(new Request(`http://localhost${path}`, { method }));
}

/** `GET /api/boards/:id`, the question a pasted link asks. */
function check(id: string): Promise<Response> {
  return SELF.fetch(new Request(`http://localhost/api/boards/${encodeURIComponent(id)}`));
}

/** A new board, made the way the product makes one. */
async function makeBoard(): Promise<string> {
  const response = await ask('/api/boards');
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** A `BOARD_ROOM` namespace that records every `idFromName` call, so "no RPC" can be proven. */
function watchingNamespace(namespace: DurableObjectNamespace<BoardRoom>): {
  readonly value: DurableObjectNamespace<BoardRoom>;
  readonly names: string[];
} {
  const names: string[] = [];
  const value = new Proxy(namespace, {
    get(target, property, receiver) {
      if (property === 'idFromName') {
        return (name: string): DurableObjectId => {
          names.push(name);
          return target.idFromName(name);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? (member as CallableFunction).bind(target) : member;
    },
  });
  return { value, names };
}

/** The Worker with a namespace that counts the boards it is asked about. */
function handlerWithWatch(): {
  fetch(request: Request): Promise<Response>;
  names: string[];
} {
  const watch = watchingNamespace(env.BOARD_ROOM);
  const watched: Env = { BOARD_ROOM: watch.value, ASSETS: env.ASSETS };
  return {
    fetch: (request: Request) => worker.fetch(request, watched),
    names: watch.names,
  };
}

describe('TC-05 making a board makes it exist (share.create)', () => {
  it('answers 201 with an id, twice over, and the two are different boards', async () => {
    const first = await ask('/api/boards');
    expect(first.status).toBe(201);
    const body = (await first.json()) as { id?: string };
    expect(typeof body.id).toBe('string');
    const id = body.id!;
    expect(id).toMatch(BOARD_ID_PATTERN);

    // The link check the client makes says yes, and says it by id.
    const seen = await check(id);
    expect(seen.status).toBe(200);
    expect(await seen.json()).toEqual({ id });

    // Ids do not repeat themselves: this is the same fact the unit test of the generator checks,
    // asked of the route that hands the ids out.
    const second = await makeBoard();
    expect(second).not.toBe(id);
    expect((await check(second)).status).toBe(200);
  });

  it('gives a board its storage at the moment it is made', async () => {
    const id = await makeBoard();
    // The tables are there because the board was created - not because anybody connected to it.
    expect(await tablesIn(id)).toEqual(
      expect.arrayContaining(['updates', 'snapshot_chunks', 'storage_meta']),
    );
    expect(await createdAt(id)).not.toBeNull();
    // Nothing has been edited yet, so there is nothing in the log.
    expect(await countRows(boardStub(id), 'updates')).toBe(0);
  });
});

describe('TC-06 a link to nothing is answered without being written down (share.not_found)', () => {
  it('says not found, and leaves the address as it found it', async () => {
    const id = newBoardId();
    const response = await check(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // The question must not be what makes a board: no tables at all, so that whoever mistypes this
    // link tomorrow finds the same nothing, and so that a probe of an address cannot be used to
    // fill a service up with empty boards.
    expect(await tablesIn(id)).toEqual([]);
    expect((await check(id)).status).toBe(404);
    expect(await tablesIn(id)).toEqual([]);
  });
});

describe('TC-07 a link that is not a link code (negative)', () => {
  it('answers 404 without asking any board', async () => {
    const handler = handlerWithWatch();
    for (const candidate of ['abc', 'a'.repeat(23), 'has space', '../x']) {
      const response = await handler.fetch(
        new Request(`http://localhost/api/boards/${encodeURIComponent(candidate)}`),
      );
      expect(response.status, candidate).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    // Not one Durable Object was addressed: a code that cannot be one is answered where it stands,
    // so this route cannot be used to wake - or to count - other people's boards.
    expect(handler.names).toEqual([]);
  });
});

describe('TC-08 a board from before the creation date is still a board (share.legacy_boards)', () => {
  it('says yes on the strength of its log', async () => {
    const id = boardId();
    // Exactly what story 4 left behind: the tables, and a change in the log - and no `created_at`,
    // because nothing wrote that row then.
    await insideBoard(boardStub(id), (store) => {
      store.append(updateOfNote('Handover between shifts misses the open tickets'));
      return true;
    });
    expect(await createdAt(id)).toBeNull();

    const response = await check(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id });

    // The room agrees, which is what lets a person on that old link in and carry on.
    expect(await boardStub(id).exists()).toBe(true);
  });

  it('says yes on the strength of a snapshot alone', async () => {
    const id = boardId();
    await insideBoard(boardStub(id), (store) => {
      // A board that had been folded up: a snapshot, and the log rows it was made from gone.
      const doc = new Y.Doc();
      store.append(updateOfNote('One idea per note keeps a crowded board readable'));
      store.compactIfNeeded(doc, true);
      return true;
    });
    expect(await countRows(boardStub(id), 'snapshot_chunks')).toBeGreaterThan(0);
    expect(await countRows(boardStub(id), 'updates')).toBe(0);
    expect((await check(id)).status).toBe(200);
  });

  it('says no to tables that hold nothing, which is a board nobody made', async () => {
    const id = boardId();
    // The tables with no creation date and no rows: nobody ever made this board, and nobody may be
    // told it exists.
    await insideBoard(boardStub(id), (store) => {
      store.migrate();
      return true;
    });
    expect(await tablesIn(id)).not.toEqual([]);
    expect((await check(id)).status).toBe(404);
  });
});

describe('TC-09 creating a board touches nothing else (share.isolation, negative)', () => {
  it('addresses one new id, and only it', async () => {
    const handler = handlerWithWatch();
    const neighbours = [boardId(), boardId()];
    for (const neighbour of neighbours) {
      await check(neighbour);
    }
    handler.names.length = 0;

    const response = await handler.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
    );
    const body = (await response.json()) as { id: string };
    expect(response.status).toBe(201);
    // Exactly one object, and it is the new board: making a board does not look at, copy or disturb
    // a board that already exists.
    expect(handler.names).toEqual([body.id]);
    expect(neighbours).not.toContain(body.id);
  });

  it('keeps a board made by one call out of every other board', async () => {
    const first = await makeBoard();
    const second = await makeBoard();
    expect(first).not.toBe(second);

    // Something written on one board is not on the other - the same question the whole story turns
    // on, asked of two boards made one after the other by the same call.
    await insideBoard(boardStub(first), (store) => {
      store.append(updateOfNote('Notes should cluster by theme'));
      return true;
    });
    const reader = new Y.Doc();
    await insideBoard(boardStub(second), (store) => store.load(reader));
    expect(notesOf(reader)).toEqual([]);
  });
});

describe('TC-10 a method that has no meaning at a board address (negative)', () => {
  it('refuses it with 405, and leaves the board alone', async () => {
    const id = await makeBoard();

    // There is no list of boards at /api/boards to change, and no board at /api/boards/:id to
    // overwrite or delete: a board is not editable through this API, only opened.
    expect((await ask('/api/boards', 'PUT')).status).toBe(405);
    expect((await ask('/api/boards', 'GET')).status).toBe(405);
    expect((await ask(`/api/boards/${id}`, 'POST')).status).toBe(405);
    expect((await ask(`/api/boards/${id}`, 'DELETE')).status).toBe(405);

    // And the board is none the worse for having been asked: still there, still answerable.
    expect((await check(id)).status).toBe(200);
  });
});

describe('TC-12 the creation call fails: say so, and hand out no link (negative)', () => {
  /** An environment whose boards cannot be made at all. */
  function unmakeable(message: string): Env {
    return {
      BOARD_ROOM: {
        idFromName: (name: string) => name as unknown as DurableObjectId,
        get: () => ({
          initialize: async (): Promise<never> => {
            throw new Error(message);
          },
        }),
      } as unknown as DurableObjectNamespace<BoardRoom>,
      ASSETS: env.ASSETS,
    } as unknown as Env;
  }

  it('answers 500 create_failed when the board could not be made', async () => {
    // The failure is injected one level below the route, in the object's own method: this is what
    // the route does when the runtime cannot be reached, when the write fails, or when the object
    // throws.
    const envBroken = unmakeable('the object could not be reached');
    expect(await createBoard(envBroken)).toEqual({ ok: false, reason: 'create_failed' });

    const response = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      envBroken,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });
  });

  it('hands out no id when the creation failed', async () => {
    const body = (await (
      await worker.fetch(
        new Request('http://localhost/api/boards', { method: 'POST' }),
        unmakeable('no storage for this board'),
      )
    ).json()) as Record<string, unknown>;
    // A body with no id in it: a client that got this answer has nothing to open, which is the
    // point - it is asked to try again instead of being sent somewhere that is not there.
    expect(body['id']).toBeUndefined();
    expect(body['error']).toBe('create_failed');
  });
});

describe('TC-14 an id that lands on a board already there is a failure (negative)', () => {
  it('refuses to serve an existing board as a newly made one', async () => {
    const id = boardId();
    const stub = boardStub(id);
    expect(await stub.initialize()).toBe('created');
    const before = await createdAt(id);
    expect(before).not.toBeNull();
    await insideBoard(stub, (store) => {
      store.append(updateOfNote('The board stays where we left it'));
      return true;
    });

    // What the route does when the id it generated lands on a board that is already there: the
    // second call says `exists`, and the board that was already there is not given away - not its
    // content, not even its creation date.
    expect(await stub.initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(before);
    expect(await countRows(stub, 'updates')).toBe(1);
  });
});

describe('TC-15 initialize twice: created, then exists, and unchanged (idempotent)', () => {
  it('writes the creation date once, and nothing else', async () => {
    const id = boardId();
    const stub = boardStub(id);
    expect(await stub.initialize()).toBe('created');
    const first = await createdAt(id);
    expect(first).not.toBeNull();

    expect(await stub.initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(first);

    // Two creations, one board: nothing was edited, and the metadata the board carries is still
    // just its version and its beginning.
    expect(await countRows(stub, 'updates')).toBe(0);
    expect(await selectRows(stub, 'SELECT key FROM storage_meta ORDER BY key')).toEqual([
      { key: 'created_at' },
      { key: 'storage_schema_version' },
    ]);

    // Opening the board is not a second creation either: a person who connects does not restart it.
    expect(await openRoom(stub)).toBe(426);
    expect(await createdAt(id)).toBe(first);
  });
});

describe('TC-32 the link is not passed on to anywhere else (share.privacy)', () => {
  it('serves a page that tells referrers to mind their own business', async () => {
    const response = await SELF.fetch(new Request('http://localhost/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    // A board's id is the only secret it has; a person clicking out of a board page should not be
    // leaving that link in somebody else's logs.
    expect(html).toContain('name="referrer"');
    expect(html).toContain('content="no-referrer"');
    // The product name, and nothing else: the tab says what the thing is, not which board is open.
    expect(html).toContain('<title>vidi6</title>');
  });
});

describe('the legacy seed hook, which is how TC-31 gets an old board at all', () => {
  /*
   * The two doors that lead to this hook - the Worker's `/__test/...` route and the room's own
   * `/internal/test/...` one - are gated on the deployment having asked for them, and this project
   * runs the deployment's configuration, which has no `TEST_HOOKS` in it. So the hook itself is
   * tested here, where the rows are, and the doors are tested from the outside; the board seeded
   * through an open door is TC-31, in the browser suite, on a server that does turn them on.
   */
  const NOTES = [
    { text: 'We keep hitting the same three blockers', x: 100, y: 100, color: 'yellow' },
    { text: 'Faster onboarding saves everybody an afternoon', x: 340, y: 180, color: 'blue' },
  ];

  it('writes a board with rows and no creation date, and it can be read back', async () => {
    const id = newBoardId();
    const written = await insideBoard(boardStub(id), (store) =>
      createLegacyBoard(
        { append: (update: Uint8Array) => store.append(update) },
        NOTES as LegacyNote[],
      ),
    );
    expect(written).toEqual({ seeded: 2, rows: written.rows });
    expect(written.rows).toBeGreaterThan(2);

    // The old shape, and only the old shape: rows in the log, no creation date anywhere.
    expect(await createdAt(id)).toBeNull();
    expect(await countRows(boardStub(id), 'updates')).toBe(written.rows);
    expect((await check(id)).status).toBe(200);
    expect(await boardStub(id).exists()).toBe(true);

    // And it is a board: the notes come back out of storage through the room's own read.
    const read = new Y.Doc();
    await insideBoard(boardStub(id), (store) => store.load(read));
    expect(notesOf(read).map((note) => note.text).sort()).toEqual(
      NOTES.map((note) => note.text).sort(),
    );
  });

  it('refuses to seed a board with notes that are not notes (negative)', async () => {
    expect(legacyNotesIn({ notes: [{ text: 'no place, no colour' }] })).toBeNull();
    expect(legacyNotesIn({})).toBeNull();
    expect(legacyNotesIn({ notes: [] })).toBeNull();
    // The colour is the board model's business, not this route's: what the room checks before it
    // writes a single row is whether it was given a text, a place and a colour to begin with -
    // which is what makes a refusal leave the address as it found it.
    expect(legacyNotesIn({ notes: [{ text: 'x', x: 1, y: 1, color: 'mauve' }] })).toEqual([
      { text: 'x', x: 1, y: 1, color: 'mauve' },
    ]);

    // A colour that does not exist is refused further down, by the board model itself, and the
    // board is not left in a state nobody can read: what went in before the refusal is a board,
    // and the note in the impossible colour is simply not on it.
    const id = newBoardId();
    await expect(
      insideBoard(boardStub(id), (store) =>
        createLegacyBoard({ append: (update: Uint8Array) => store.append(update) }, [
          { text: 'One idea per note', x: 1, y: 1, color: 'yellow' },
          { text: 'A colour nobody has', x: 2, y: 2, color: 'mauve' },
        ]),
      ),
    ).rejects.toThrow();
    const read = new Y.Doc();
    await insideBoard(boardStub(id), (store) => store.load(read));
    expect(notesOf(read).map((note) => note.text)).toEqual(['One idea per note']);
  });

  it('is not a route at all when the deployment did not ask for it (negative)', async () => {
    const id = newBoardId();
    // The response is whatever the assets make of an unknown path - never a board being written.
    const response = await SELF.fetch(
      new Request(`http://localhost/__test/boards/${id}/seed-legacy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: NOTES }),
      }),
    );
    expect(response.status).not.toBe(200);
    expect(await tablesIn(id)).toEqual([]);
    expect((await check(id)).status).toBe(404);

    // The room's own door, from the inside: asked without the deployment having opened it, the
    // answer is the one this room gives to anything that is not a connection.
    const refused = await boardStub(id).fetch(
      new Request('http://board-room/internal/test/seed-legacy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: NOTES }),
      }),
    );
    expect(refused.status).toBe(404);
    expect(await tablesIn(id)).toEqual([]);
    expect((await check(id)).status).toBe(404);
  });
});
