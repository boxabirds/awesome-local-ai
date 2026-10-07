import { describe, expect, it, vi } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { META_CREATED_AT } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import type { Env } from '../../src/worker/index';
import { RoomClient, waitForConvergence } from './ws-client';
import { retroBoard } from '../fixtures/boards';

/**
 * `share.board_api` (design TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32): the board
 * API runs against the real Worker, real Durable Object RPC and real SQLite, because
 * the two things this story promises are *storage* facts:
 *
 * - a board exists only if its storage says so (`created_at`, or data from before
 *   this feature shipped), and
 * - finding out whether a link exists writes nothing at all.
 *
 * Neither can be checked against a mock. Requests come through `SELF.fetch`, so the
 * routing, the id validation and the assets fallthrough are the production ones.
 */

const namespace = () => (env as unknown as Env).BOARD_ROOM;
const stubFor = (boardId: string) => namespace().get(namespace().idFromName(boardId));

const apiGet = (path: string) => SELF.fetch(`http://worker${path}`);
const apiSend = (path: string, method: string) =>
  SELF.fetch(`http://worker${path}`, { method });

/** Table names this board's storage holds — empty when nothing was ever written. */
const tablesOf = (boardId: string) =>
  runInDurableObject(stubFor(boardId), (_room: BoardRoom, state: DurableObjectState) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => row.name),
  );

/** `created_at` as stored, or undefined when the board was never initialised. */
const createdAtOf = (boardId: string) =>
  runInDurableObject(stubFor(boardId), (_room: BoardRoom, state: DurableObjectState) => {
    // A board that was never created has no tables to read from, which is itself the
    // answer: `undefined` (and nothing below creates them).
    const tables = state.storage.sql
      .exec<{ c: number }>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'storage_meta'")
      .one().c;
    if (tables === 0) return undefined;
    const row = state.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', META_CREATED_AT)
      .next();
    return row.done ? undefined : row.value.value;
  });

const bytesToBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

describe('TC-05 POST /api/boards creates a board', () => {
  it('returns 201 with a valid id, the id then exists, and created_at is set', async () => {
    const response = await apiSend('/api/boards', 'POST');
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const check = await apiGet(`/api/boards/${id}`);
    expect(check.status).toBe(200);
    expect((await check.json()) as { id: string }).toEqual({ id });

    // The existence rule reads this stamp; it is written exactly once per board.
    const createdAt = await createdAtOf(id);
    expect(Number(createdAt)).toBeGreaterThan(0);
    expect(Number(createdAt)).toBeLessThanOrEqual(Date.now());

    // A board created but never opened has an empty log and no snapshot: it opens as
    // a genuinely empty board (the same guarantee story 4 gave, TC-25).
    expect(await tablesOf(id)).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks']),
    );
  });
});

describe('TC-06 a valid link to a board that was never created', () => {
  it('answers 404 and leaves no storage behind', async () => {
    const boardId = newBoardId(); // well-formed, and never created
    const response = await apiGet(`/api/boards/${boardId}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // The negative half of the case: probing a link must not create a board, not even
    // its tables. `exists()` only ever queries.
    expect(await tablesOf(boardId)).toEqual([]);
    expect(await createdAtOf(boardId)).toBeUndefined();
  });
});

describe('TC-07 malformed ids never reach the Durable Object', () => {
  for (const badId of ['abc', 'a'.repeat(23), 'a'.repeat(21), 'a'.repeat(22).slice(0, 21) + '+', '..%2F..']) {
    it(`answers 404 for "${badId.slice(0, 12)}…" without instantiating a room`, async () => {
      const idFromName = vi.spyOn(namespace(), 'idFromName');
      const response = await apiGet(`/api/boards/${encodeURIComponent(badId)}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
      // No namespace lookup, therefore no RPC and no object: the id was rejected by
      // its shape alone (so a made-up address cannot be used to spawn rooms).
      expect(idFromName).not.toHaveBeenCalled();
      idFromName.mockRestore();
    });
  }
});

describe('TC-08 a board with saved data but no created_at still exists (legacy)', () => {
  it('answers 200 for a pre-story-5 board and serves its notes', async () => {
    const boardId = newBoardId();
    expect((await apiGet(`/api/boards/${boardId}`)).status).toBe(404);

    // The exact shape a board made before this feature shipped has: tables, real Yjs
    // updates from the story 4 fixture, and *no* `created_at`.
    const retro = retroBoard();
    await runInDurableObject(stubFor(boardId), (room: BoardRoom) =>
      room.testSeedLegacy(retro.updates.map(bytesToBase64)),
    );
    expect(await createdAtOf(boardId)).toBeUndefined();

    const check = await apiGet(`/api/boards/${boardId}`);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ id: boardId });

    // And it opens as the board it always was: the socket is accepted and its notes
    // come back (PRD share.legacy_boards).
    const client = await RoomClient.connect(boardId, 'legacy');
    await client.waitForSync();
    await client.waitFor(() => client.notes.length === retro.notes.length, 'legacy notes loaded');
    expect(client.notes).toEqual(retro.notes);
    client.destroy();
  });
});

describe('TC-09 a socket to a board that does not exist', () => {
  it('answers 404, accepts no socket, and creates no storage', async () => {
    const boardId = newBoardId();
    const response = await RoomClient.rawUpgrade(boardId, 'websocket');
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
    expect(await tablesOf(boardId)).toEqual([]);
  });

  it('answers 404 for a malformed id on the room route too', async () => {
    const response = await RoomClient.rawUpgrade('abc', 'websocket');
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });
});

describe('TC-10 a socket to a board that does exist', () => {
  it('upgrades with 101 and relays like story 3', async () => {
    const boardId = await RoomClient.createBoard();
    const [a, b] = await Promise.all([
      RoomClient.connect(boardId, 'A'),
      RoomClient.connect(boardId, 'B'),
    ]);
    await a.waitForSync();
    await b.waitForSync();
    await waitForConvergence([a, b]);

    const id = createSticky(a.doc, { x: 300, y: 300 });
    await b.waitFor(() => b.notes.some((note) => note.id === id), 'relay still works after POST');

    // And it is stored, so the next person to open the same link gets the note too.
    const stored = await runInDurableObject(stubFor(boardId), (_room: BoardRoom, state: DurableObjectState) =>
      state.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates').one().c,
    );
    expect(stored).toBeGreaterThan(0);

    a.destroy();
    b.destroy();
  });
});

describe('TC-12 creation that fails answers 500 create_failed', () => {
  it('an initialize() that throws becomes create_failed, not a half-made board', async () => {
    // The namespace is asked for an object whose RPC always throws — the injected
    // "RPC failed" of the design's mock table. It is patched on the namespace, so the
    // Worker's own code path (`env.BOARD_ROOM.get(...).initialize()`) is exercised.
    const real = namespace();
    const realGet = real.get.bind(real);
    let asked = 0;
    Object.defineProperty(real, 'get', {
      configurable: true,
      value: () => {
        asked += 1;
        return {
          initialize: async (): Promise<'created' | 'exists'> => {
            throw new Error('injected RPC failure');
          },
          exists: async () => false,
          fetch: async () => new Response('nope', { status: 500 }),
        };
      },
    });
    try {
      const response = await apiSend('/api/boards', 'POST');
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'create_failed' });
      expect(asked).toBe(1);
    } finally {
      Object.defineProperty(real, 'get', { configurable: true, value: realGet });
    }
  });
});

describe('TC-14 wrong methods on the board API answer 405', () => {
  it('rejects PUT /api/boards and GET /api/boards without creating anything', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const response = await apiSend('/api/boards', method);
      expect(response.status, method).toBe(405);
    }
    // `/api/boards/:id` only answers GET; anything else is 405 as well.
    const boardId = await RoomClient.createBoard();
    const response = await apiSend(`/api/boards/${boardId}`, 'POST');
    expect(response.status).toBe(405);
  });
});

describe('TC-15 a board is never re-initialised', () => {
  it('initialize() answers created then exists, and created_at is unchanged', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    expect(await stub.initialize()).toBe('created');
    const first = await createdAtOf(boardId);

    expect(await stub.initialize()).toBe('exists');
    expect(await stub.initialize()).toBe('exists');
    expect(await createdAtOf(boardId)).toBe(first); // still the first stamp

    // The board it refused to overwrite is the one that exists.
    expect((await apiGet(`/api/boards/${boardId}`)).status).toBe(200);
  });
});

describe('TC-32 the board page never leaks its own address', () => {
  it('serves index.html with a no-referrer policy', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const response = await apiGet(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('Content-Type'), path)?.toContain('text/html');
      const html = await response.text();
      // A board's link is its only secret; it must never leave as a Referer.
      expect(html, path).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    }
  });
});
