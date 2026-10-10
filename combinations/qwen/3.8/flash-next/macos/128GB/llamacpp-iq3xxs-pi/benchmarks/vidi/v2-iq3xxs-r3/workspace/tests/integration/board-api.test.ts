/**
 * TC-05 to TC-10, TC-12, TC-14, TC-15 and TC-32 — the board API
 * (share.board_api, share.legacy_boards), inside real workerd: a real `fetch`
 * handler, a real Durable Object namespace, real RPC, real SQLite, real sockets.
 *
 * Two things are checked over and over, because they are the two ways this story
 * could go wrong without anyone noticing:
 *
 * - *what a link is worth*: 201 for a board that was just made, 404 for one that
 *   was not, and the same 404 for a link that could not be one at all;
 * - *what asking cost*: asking whether a link leads to a board must leave no
 *   table behind. A probe that wrote storage would turn every typo ever pasted
 *   into a board, and every scan of the id space into a disk full of them.
 */
import { env, listDurableObjectIds, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';

import { largeBoard } from '../fixtures/boards';

import { countRows, tableNames } from './broken-storage';
import {
  BoardClient,
  createNote,
  roomUrl,
  settle,
  synced,
  waitFor,
} from './ws-client';

/** A request to the worker under test. */
const url = (path: string): string => `http://permitted.invalid${path}`;

/** `POST /api/boards`, as the browser's **New board** button calls it. */
async function post(path = '/api/boards'): Promise<Response> {
  return SELF.fetch(url(path), { method: 'POST' });
}

/** `GET /api/boards/<id>`, as the board page calls it. */
async function get(id: string): Promise<Response> {
  return SELF.fetch(url(`/api/boards/${id}`));
}

/** This board's room stub, for the calls the Worker makes on its behalf. */
const roomOf = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/** Ask one board's storage a question from outside (wakes the room if asleep). */
function peek<T>(boardId: string, ask: (storage: DurableObjectStorage) => T): Promise<T> {
  return runInDurableObject(roomOf(boardId), (_room, state) => ask(state.storage));
}

/** What a board's storage says about itself, in terms a failure can be read. */
interface StoredFacts {
  readonly tables: string[];
  readonly created_at: string | undefined;
  readonly rows: number;
  readonly chunks: number;
}

function storedFacts(boardId: string): Promise<StoredFacts> {
  return peek(boardId, (storage) => {
    const tables = tableNames(storage);
    const has = (table: string): boolean => tables.includes(table);
    const created = has('storage_meta')
      ? storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray()
      : [];
    return {
      tables,
      created_at: created.length === 0 ? undefined : String(created[0].value),
      rows: has('updates') ? countRows(storage, 'updates') : 0,
      chunks: has('snapshot_chunks') ? countRows(storage, 'snapshot_chunks') : 0,
    };
  });
}

/** Every object the namespace has ever been asked for, as a stable count. */
const objectsHeld = async (): Promise<number> => (await listDurableObjectIds(env.BOARD_ROOM)).length;

/**
 * What the worker said out loud (`console.error`) while an awaited request was in
 * flight — how a 500 is told apart from a 500 that quietly ate a failure.
 */
async function whileSpeaking(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines;
}

/** `POST /api/boards`, and the board it made is answerable straight away. */
describe('POST /api/boards makes a board (TC-05, share.board_api)', () => {
  it('answers 201 with a link code that leads to a board', async () => {
    const created = await post();
    expect(created.status).toBe(201);
    const body = await created.json<{ id: string }>();
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    // Before anybody is told the id, the room behind it was initialised — so the
    // same link answers 200 the first time it is asked (share.open_link).
    const checked = await get(body.id);
    expect(checked.status).toBe(200);
    await expect(checked.json()).resolves.toEqual({ id: body.id });

    // And it is a fact of storage, not of the request that made it: the tables
    // exist and `created_at` says when this board started.
    const facts = await storedFacts(body.id);
    expect(facts.tables.sort()).toEqual(
      ['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates'].sort(),
    );
    expect(facts.created_at).toBeDefined();
    const madeAt = Number(facts.created_at);
    expect(Number.isFinite(madeAt)).toBe(true);
    expect(madeAt).toBeGreaterThan(0);
    // Creation writes no update rows: a board nobody has drawn on is still a
    // board with nothing on it (story 4's TC-25 stays true).
    expect(facts.rows).toBe(0);
    expect(facts.chunks).toBe(0);
  });

  it('answers 405 for the methods the collection does not have (TC-14)', async () => {
    for (const path of ['/api/boards', '/api/boards/']) {
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
        const response = await SELF.fetch(url(path), { method });
        expect(response.status, `${method} ${path}`).toBe(405);
      }
    }
    // A board does not answer to anything but the question about it either.
    const board = await (await post()).json<{ id: string }>();
    const renamed = await SELF.fetch(url(`/api/boards/${board.id}`), { method: 'DELETE' });
    expect(renamed.status).toBe(405);
  });
});

/** A link that leads nowhere, and the cost of asking. */
describe('a link that leads nowhere (TC-06, TC-07, share.not_found)', () => {
  it('answers 404 for a valid id nobody made, and writes nothing while asking (TC-06, negative)', async () => {
    const neverMade = newBoardId();
    const response = await get(neverMade);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });

    // The negative half of the case: the question was answered, and the answer
    // is not "there is a board now". A stranger's link costs one read of
    // `sqlite_master` and no writes at all.
    const facts = await storedFacts(neverMade);
    expect(facts.tables).toEqual([]);
    expect(facts.created_at).toBeUndefined();
  });

  it('answers 404 without asking the room anything about a malformed id (TC-07, negative)', async () => {
    const held = await objectsHeld();
    const tooShort = newBoardId().slice(0, 21);
    const tooLong = `${newBoardId()}A`;
    const cases: readonly string[] = [
      'abc', // too short by 19 characters, and not base64url at all
      tooShort, // the boundary just under a link code
      tooLong, // the boundary just over one
      'a%2Fb', // a `/` in the path, percent-encoded
      '../etc/passwd'.replaceAll('/', '%2F'), // what looks like traversal, and is not
      'SPUq8nMPQEGm7c5BpXmzK+', // ordinary base64 characters
      'SPUq8nMPQEGm7c5BpXmzK=', // base64 padding
    ];
    for (const id of cases) {
      const response = await get(id);
      expect(response.status, `GET /api/boards/${id}`).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not_found' });
    }
    // None of them reached the namespace, so none of them instantiated a room:
    // "no RPC call was made" is measured by there being no object to make a call
    // on.
    await expect(objectsHeld()).resolves.toBe(held);
  });

  it('still opens a board that only has content to show for it (TC-08, share.legacy_boards)', async () => {
    const legacy = newBoardId();
    // A board from before this story existed: real changes in the log, and no
    // `created_at` row, because that row is what this story adds.
    const seeded = await peek(legacy, (storage) => {
      const store = new BoardStore(storage);
      const built = largeBoard(3, 5);
      store.migrate();
      for (const update of built.updates) store.append(update);
      return { updates: built.updates.length, notes: built.notes.length };
    });
    expect(seeded.updates).toBeGreaterThan(0);

    const before = await storedFacts(legacy);
    expect(before.created_at).toBeUndefined(); // legacy by construction
    expect(before.rows).toBeGreaterThan(0);

    // Its old link still works, which is the whole promise of share.legacy_boards.
    const response = await get(legacy);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: legacy });
    // Answering did not tidy the board up, either.
    const after = await storedFacts(legacy);
    expect(after).toEqual(before);

    // And answering "yes" is only half the promise: the board has to open *with*
    // what is on it. Here that is measured at the log itself — read the rows back
    // into a document the way a room does — because a fixture whose earliest
    // change is missing answers 200 and shows an empty board. Measured: with such
    // a log the notes are in storage and `snapshot()` finds nothing at all.
    // (That the notes then reach a browser is TC-31, where the board is stood up
    // through the room that will serve it, as in production.)
    const readable = await peek(legacy, (storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      const loaded = new BoardStore(storage).load(doc);
      return { ok: loaded.ok, notes: snapshot(doc).map((note) => String(note.text)) };
    });
    expect(readable.ok).toBe(true);
    expect(readable.notes.length).toBe(seeded.notes);
  });
});

/** The websocket door of a board: story 3, plus the fact that it now opens onto
 * something. */
describe('the websocket door (TC-09, TC-10, share.not_found)', () => {
  /** An upgrade request, exactly as the client writes it. */
  const upgrade = (): RequestInit => ({ headers: { Upgrade: 'websocket' } });

  it('answers 404 for a board that was never made, and does not make one (TC-09, negative)', async () => {
    const neverMade = newBoardId();
    const response = await SELF.fetch(url(`/api/rooms/${neverMade}`), upgrade());
    expect(response.status).toBe(404);
    // No socket half: the handshake ends there, and the client is left with the
    // status the board page knows what to do with.
    expect(response.webSocket ?? null).toBeNull();

    // The room itself gives the same answer when it is asked directly, so the
    // 404 is a fact about the room and not only about the route in front of it.
    const direct = await roomOf(neverMade).fetch(
      new Request(roomUrl(neverMade), { headers: { Upgrade: 'websocket' } }),
    );
    expect(direct.status).toBe(404);

    // And asking for the door did not build the house.
    const facts = await storedFacts(neverMade);
    expect(facts.tables).toEqual([]);
  });

  it('opens a board that was made, and the story 3 sync runs over it (TC-10)', async () => {
    const made = await (await post()).json<{ id: string }>();
    const response = await SELF.fetch(url(`/api/rooms/${made.id}`), upgrade());
    expect(response.status).toBe(101);
    const handed = response.webSocket;
    expect(handed).toBeInstanceOf(WebSocket);
    if (handed) {
      // This response is only about the handshake; the clients below are the
      // participants.
      handed.accept();
      handed.close(1000, 'handshake checked');
    }

    const first = await BoardClient.join(made.id);
    const second = await BoardClient.join(made.id);
    try {
      await synced(first);
      await synced(second);
      expect(first.notes()).toHaveLength(0);

      const id = createNote(first, { x: 60, y: 60 });
      await waitFor('the other participant has the note', () =>
        second.notes().some((note) => note.id === id),
      );
      await settle(second);
      expect(second.notes()[0]?.x).toBe(first.notes()[0]?.x);

      // The change the room relayed is in storage, one row: a board made by this
      // story is a board that persists like any other.
      const facts = await storedFacts(made.id);
      expect(facts.rows).toBeGreaterThan(0);
      expect(facts.created_at).toBeDefined();
    } finally {
      first.leave();
      second.leave();
    }
  });
});

/** The error path of creation: the room would not answer. */
describe('a board that could not be created (TC-12, share.create_failure)', () => {
  it('answers 500 create_failed when the room refuses to be initialised', async () => {
    // The design's injected failure: not a fake `fetch`, but the room's own
    // `initialize` throwing, so the RPC rejects for real and the Worker has to
    // turn that into the contract's 500. (The pool prints the room's side of that
    // rejection as an uncaught exception — the failure we injected, seen from the
    // side that has nobody to catch it; the Worker's catch below is the point.)
    const refusal = 'simulated: the room would not answer';
    vi.spyOn(BoardStore.prototype, 'initialize').mockImplementation(() => {
      throw new Error(refusal);
    });

    let status = 0;
    let body: unknown;
    const lines = await whileSpeaking(async () => {
      const response = await post();
      status = response.status;
      body = await response.json();
    });
    vi.restoreAllMocks();

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'create_failed' });
    // Said out loud: a 500 nobody can diagnose is a 500 that will be blamed on
    // the browser.
    expect(lines.some((line) => line.includes(refusal))).toBe(true);

    // One request's failure, not a broken service: the next click works, and the
    // board it made is a board anybody holding the link can open.
    const next = await post();
    expect(next.status).toBe(201);
    const madeId = (await next.json<{ id: string }>()).id;
    await expect((await get(madeId)).json()).resolves.toEqual({ id: madeId });
  });
});

/** `initialize()` is one fact about an address, asked once. */
describe('a board is initialised once (TC-15, share.board_api)', () => {
  it('refuses to re-initialise a board that already is one', async () => {
    const boardId = newBoardId();
    // Before anything at all: not a board, and nothing written for asking.
    await expect(roomOf(boardId).exists()).resolves.toBe(false);
    expect((await storedFacts(boardId)).tables).toEqual([]);

    expect(await roomOf(boardId).initialize()).toBe('created');
    const facts = await storedFacts(boardId);
    expect(facts.created_at).toBeDefined();
    expect(await roomOf(boardId).exists()).toBe(true);

    // A second call — a retried request, a curious second worker, a test — cannot
    // make the board younger, and cannot make it twice.
    expect(await roomOf(boardId).initialize()).toBe('exists');
    await expect(storedFacts(boardId)).resolves.toEqual(facts);

    // So `POST /api/boards` would never hand out this address a second time: an
    // id collision fails loudly instead of opening two boards at one link.
  });

  it('recognises a legacy board as one that already exists', async () => {
    const legacy = newBoardId();
    const rows = await peek(legacy, (storage) => {
      const store = new BoardStore(storage);
      store.migrate(); // the tables, and nothing else: no `created_at`
      const built = largeBoard(1, 7);
      for (const update of built.updates) store.append(update);
      return built.updates.length;
    });
    // The answer is about the board that was here before the call, not about the
    // row the call adds.
    expect(await roomOf(legacy).initialize()).toBe('exists');
    const facts = await storedFacts(legacy);
    expect(facts.created_at).toBeDefined();
    expect(facts.rows).toBe(rows);
  });
});

/** The document the board page is served with (TC-32). */
describe('the client sent to a browser (TC-32, negative)', () => {
  it('tells the browser to send no Referer, so a board link leaves no trace', async () => {
    const home = await SELF.fetch(url('/'), { headers: { Accept: 'text/html' } });
    expect(home.status).toBe(200);
    const html = await home.text();
    // A board's link is its only access control, so a page that loads a third
    // party script must not be able to report which board was open.
    // Matched without the closing syntax, because it is the *declaration* that
    // matters and not whether the bundler kept the slash.
    expect(html).toContain('<meta name="referrer" content="no-referrer"');

    // The same document at a board route, because it is the same client.
    const board = await SELF.fetch(url(`/b/${newBoardId()}`), {
      headers: { Accept: 'text/html' },
    });
    expect(board.status).toBe(200);
    await expect(board.text()).resolves.toBe(html);
  });
});
