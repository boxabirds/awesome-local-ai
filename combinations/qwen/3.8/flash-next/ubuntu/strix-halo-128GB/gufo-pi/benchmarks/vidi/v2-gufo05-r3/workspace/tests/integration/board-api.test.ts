/**
 * The board API (story 5, task 2): TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.
 *
 * Runs inside workerd against the real Worker, the real `BOARD_ROOM` namespace
 * and real SQLite, because everything here — "did this link create anything?",
 * "does the object's existence answer touch storage?" — is a property of those
 * three working together.
 *
 * Read-only probes must not write. That is asserted the way the design states it:
 * ask about a never-created id, then open the object and check `sqlite_master` —
 * none of the app tables may exist.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createSticky, initDoc } from '../../src/shared/board-model';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { connectAll, freshBoardId } from './ws-client';

const APP_TABLES = new Set(['storage_meta', 'updates', 'snapshot_chunks']);

const url = (path: string) => `http://whiteboard.local${path}`;
const stub = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/** A single saved update, to make a "legacy" board that predates story 5. */
function oneUpdate(): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);
  createSticky(doc, { x: 8, y: 8 });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** The app tables present in a board's SQLite, with nothing created by us. */
function presentTables(boardId: string): Promise<string[]> {
  return runInDurableObject(stub(boardId), (room) => room.store.tableNames());
}

describe('POST /api/boards creates a board (TC-05)', () => {
  it('returns 201 and a link-shaped id, and stamps it into storage', async () => {
    const response = await SELF.fetch(url('/api/boards'), { method: 'POST' });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    // The same id now answers as existing over the API.
    const check = await SELF.fetch(url(`/api/boards/${id}`));
    expect(check.status).toBe(200);
    expect((await check.json() as { id: string }).id).toBe(id);

    // The object's storage was created, and `created_at` was set.
    const created = await runInDurableObject(stub(id), (room) => ({
      isCreated: room.store.isCreated(),
      createdAt: room.store.createdAt(),
    }));
    expect(created.isCreated).toBe(true);
    expect(created.createdAt).not.toBeNull();
    expect(created.createdAt!).toBeGreaterThan(0);
  });
});

describe('GET /api/boards/:id answers existence without writing (TC-06, TC-07)', () => {
  it('404s a never-created id and leaves no tables behind', async () => {
    const id = freshBoardId();
    const response = await SELF.fetch(url(`/api/boards/${id}`));
    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toBe('not_found');

    const tables = await presentTables(id);
    expect(tables.filter((name) => APP_TABLES.has(name))).toEqual([]);
  });

  it('404s a malformed id without calling idFromName at all', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    try {
      const before = spy.mock.calls.length;
      for (const id of ['abc', 'a'.repeat(23)]) {
        const response = await SELF.fetch(url(`/api/boards/${encodeURIComponent(id)}`));
        expect(response.status, id).toBe(404);
        expect(response.ok).toBe(false);
      }
      // Existence was answered from the address alone; the namespace was never touched.
      expect(spy.mock.calls.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a pre-story-5 board that has content but no created_at as existing (TC-08)', async () => {
    const board = freshBoardId();
    // The state such a board is in: its tables exist and hold an update, but the
    // creation stamp does not. Written directly, exactly as the old code left it.
    await runInDurableObject(stub(board), (room) => {
      room.store.migrate();
      room.store.append(oneUpdate());
    });
    const state = await runInDurableObject(stub(board), (room) => ({
      created: room.store.isCreated(),
      exists: room.store.existsReadOnly(),
    }));
    expect(state.created).toBe(false);
    expect(state.exists).toBe(true);

    const response = await SELF.fetch(url(`/api/boards/${board}`));
    expect(response.status).toBe(200);
  });
});

describe('connecting cannot create a board (TC-09)', () => {
  it('404s a socket upgrade to an unknown id, accepts no socket, writes nothing', async () => {
    const id = freshBoardId();
    const response = await SELF.fetch(url(`/api/rooms/${id}`), {
      headers: { upgrade: 'websocket' },
    });
        expect(response.status).toBe(404);
    expect(response.webSocket).toBeFalsy();

    const tables = await presentTables(id);
    expect(tables.filter((name) => APP_TABLES.has(name))).toEqual([]);
  });

  it('upgrades and syncs for a board created through POST (TC-10)', async () => {
    const response = await SELF.fetch(url('/api/boards'), { method: 'POST' });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    const [a, b] = await connectAll(id, 2);
    createSticky(a.doc, { x: 10, y: 20 });
    // The board created through POST is joinable and syncs (story 3 still works).
    await b.seesNoteCount(1);

    for (const client of [a, b]) client.destroy();
  });
});

describe('creation failure is reported, not swallowed (TC-12, TC-14, TC-15)', () => {
  it('500s with create_failed when initialize throws', async () => {
    const getSpy = vi.spyOn(env.BOARD_ROOM, 'get').mockReturnValue({
      initialize: async () => {
        throw new Error('injected: storage unavailable');
      },
    } as unknown as ReturnType<typeof env.BOARD_ROOM.get>);
    try {
      const response = await SELF.fetch(url('/api/boards'), { method: 'POST' });
      expect(response.status).toBe(500);
      expect((await response.json() as { error: string }).error).toBe('create_failed');
    } finally {
      getSpy.mockRestore();
    }
  });

  it('answers 405 for a method other than POST on the collection', async () => {
    const response = await SELF.fetch(url('/api/boards'), { method: 'PUT' });
    expect(response.status).toBe(405);
  });

  it('initialize() creates once then reports exists, with created_at unchanged (TC-15)', async () => {
    const board = freshBoardId();
    const outcome = await runInDurableObject(stub(board), async (room) => {
      const first = await room.initialize();
      const stampAfterFirst = room.store.createdAt();
      const second = await room.initialize();
      const stampAfterSecond = room.store.createdAt();
      return { first, second, stampAfterFirst, stampAfterSecond };
    });
    expect(outcome.first).toBe('created');
    expect(outcome.second).toBe('exists');
    expect(outcome.stampAfterFirst).not.toBeNull();
    expect(outcome.stampAfterSecond).toBe(outcome.stampAfterFirst);
  });
});

describe('the board page never leaks its link as a referrer (TC-32)', () => {
  it('serves index.html with a no-referrer meta tag', async () => {
    const response = await SELF.fetch(url('/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i);
  });
});
