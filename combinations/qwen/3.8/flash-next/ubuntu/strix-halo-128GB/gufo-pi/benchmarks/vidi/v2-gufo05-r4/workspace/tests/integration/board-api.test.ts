/**
 * Integration: the board API (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32).
 *
 * This is the layer where a link either means something or does not, so nothing is
 * mocked: `SELF.fetch` is the real Worker, `initialize()` and `exists()` are real Durable
 * Object RPC, and the rows are real SQLite. The two claims that matter most are the
 * negative ones — that following a link to a board that was never created leaves *no
 * storage behind*, and that a malformed address never even wakes an object — and both are
 * answered by reading `sqlite_master` and by spying on the namespace, not by trusting the
 * status code.
 */

import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import worker, { type Env } from '../../src/worker/index';
import { retroBoard } from '../fixtures/boards';
import { ensureBoard, join, leaveAll, TestClient, waitForConvergence } from './helpers/ws-client';

/** The room that owns this board, as the platform addresses it. */
function stubFor(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Ask the exported handler directly, for the cases that must not reach the runtime's
 * own environment (a broken RPC cannot be arranged any other way). */
const callWorker = worker.fetch as unknown as (request: Request, env: Env) => Promise<Response>;

/** `POST /api/boards`. */
function createBoardRequest(): Promise<Response> {
  return SELF.fetch('https://vidi6.example/api/boards', { method: 'POST' });
}

/** `GET /api/boards/<id>`. */
function checkBoardRequest(id: string, method = 'GET'): Promise<Response> {
  return SELF.fetch(`https://vidi6.example/api/boards/${id}`, { method });
}

/** The tables this board's database holds, SQLite's own bookkeeping left out. */
function tablesOf(boardId: string): Promise<string[]> {
  return runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => String(row.name))
      .filter((name) => !name.startsWith('sqlite_'))
  );
}

/** The board's creation time, or null when nothing recorded it. */
function createdAtOf(boardId: string): Promise<string | null> {
  return runInDurableObject(stubFor(boardId), (_room, state) => {
    const tables = state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => String(row.name));
    if (!tables.includes('storage_meta')) return null;
    const row = state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray()[0];
    return row === undefined ? null : String(row.value);
  });
}

describe('making a board', () => {
  // TC-05
  it('answers POST with an address that exists, in storage as well as in the response', async () => {
    const response = await createBoardRequest();
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    // The address is not a promise about the future: it exists right now.
    const check = await checkBoardRequest(body.id);
    expect(check.status).toBe(200);
    expect(((await check.json()) as { id: string }).id).toBe(body.id);

    // And "exists" is a row, not an in-memory flag: `created_at`, epoch milliseconds.
    const created = await createdAtOf(body.id);
    expect(created).not.toBeNull();
    expect(Number(created)).toBeGreaterThan(0);
    expect(Number(created)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // TC-14
  it('refuses a method the board collection does not have', async () => {
    const put = await SELF.fetch('https://vidi6.example/api/boards', { method: 'PUT' });
    expect(put.status).toBe(405);

    // The collection is not a list either (stories 14-15 will make it one, on purpose).
    expect((await checkBoardRequest(newBoardId(), 'DELETE')).status).toBe(405);
    expect((await SELF.fetch('https://vidi6.example/api/boards', { method: 'GET' })).status).toBe(405);
  });

  // TC-12 (error path: the RPC itself is broken)
  it('says create_failed rather than half-creating a board when the RPC fails', async () => {
    const broken = {
      idFromName: () => 'broken-id',
      get: () => ({
        initialize: async () => {
          throw new Error('the room is not listening');
        }
      })
    };
    const response = await callWorker(
      new Request('https://vidi6.example/api/boards', { method: 'POST' }),
      { ...env, BOARD_ROOM: broken } as unknown as Env
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });

    // The same answer when a *fresh* address turns out to name a board that already
    // exists — the collision the design refuses to retry rather than paper over.
    const alreadyThere = {
      idFromName: () => 'collision-id',
      get: () => ({ initialize: async () => 'exists' as const })
    };
    const collision = await callWorker(
      new Request('https://vidi6.example/api/boards', { method: 'POST' }),
      { ...env, BOARD_ROOM: alreadyThere } as unknown as Env
    );
    expect(collision.status).toBe(500);
    expect(await collision.json()).toEqual({ error: 'create_failed' });
  });

  // TC-15 (negative: an existing board is never re-initialised)
  it('initialises a board once, and says so the second time', async () => {
    const boardId = newBoardId();
    expect(await ensureBoard(boardId)).toBe('created');
    const first = await createdAtOf(boardId);
    expect(first).not.toBeNull();

    expect(await ensureBoard(boardId)).toBe('exists');
    expect(await createdAtOf(boardId)).toBe(first);
  });
});

describe('asking whether a board exists', () => {
  // TC-06 (negative: a probe writes nothing)
  it('answers 404 for an address that was never created, and leaves no storage behind', async () => {
    const boardId = newBoardId();
    const response = await checkBoardRequest(boardId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(await tablesOf(boardId)).toEqual([]);
    expect(await createdAtOf(boardId)).toBeNull();
  });

  // TC-07 (negative: a malformed address never reaches a Durable Object)
  it('answers 404 for a malformed address without waking anything', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const malformed = [
      'abc',
      'a'.repeat(23),
      'a'.repeat(21),
      'bad!id',
      // A path of its own: nothing here is a board address, and nothing here may be
      // treated as one by taking the first part of it.
      `${'A'.repeat(22)}%2F..`
    ];
    for (const candidate of malformed) {
      const response = await checkBoardRequest(candidate);
      expect(response.status, `${candidate} should be 404`).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  // TC-08 (`share.legacy_boards`)
  it('counts a board that holds content from before links existed as existing', async () => {
    const boardId = newBoardId();
    const session = retroBoard({ notes: 3, authors: 1 });

    // The exact shape such a board is in: update rows, and no `created_at` anywhere.
    await runInDurableObject(stubFor(boardId), (_room, state) => {
      new BoardStore(state.storage).seedLegacy(session.updates);
    });
    expect(await createdAtOf(boardId)).toBeNull();

    const response = await checkBoardRequest(boardId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(boardId);
  });
});

describe('joining a board over the wire', () => {
  // TC-09 (negative: no socket, no storage)
  it('refuses a WebSocket upgrade to a board that does not exist', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.example/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' }
    });
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();
    expect(await tablesOf(boardId)).toEqual([]);
  });

  // TC-10
  it('takes a connection to a board the API created, and syncs it like story 3', async () => {
    const created = await createBoardRequest();
    const { id } = (await created.json()) as { id: string };

    // `create: false` — these joins are only allowed to work because the API did its job.
    const clients = [await join(id, { create: false }), await join(id, { create: false })];
    try {
      expect(clients.every((client) => client.synced)).toBe(true);

      const noteId = createSticky(clients[0].doc, { x: 30, y: 40 });
      await TestClient.waitUntil(
        () => clients.every((client) => client.snapshot().some((note) => note.id === noteId)),
        5000,
        'every editor on the created board to see the note'
      );
      await waitForConvergence(clients);
    } finally {
      await leaveAll(clients);
    }
  });
});

describe('what the client is served', () => {
  // TC-32 (negative: a board's address never leaves the page)
  it('sends no referrer anywhere, so a shared link is not repeated to strangers', async () => {
    for (const path of ['/', '/b/' + newBoardId()]) {
      const response = await SELF.fetch(`https://vidi6.example${path}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      // The build writes the self-closing form; either spelling of an empty element is
      // the same instruction to a browser.
      expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
    }
  });
});
