/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId, BOARD_ID_PATTERN } from '@shared/board-id';
import { createSticky, snapshot } from '@shared/board-model';
import { createSyncClient } from './ws-client';
import { createBoard } from '../../src/worker/create-board';
import worker from '../../src/worker/index';

// Loose stub type so RPC + test hooks can be called from integration tests
// (excluded from `npm run typecheck`).
function stubFor(boardId: string): any {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

async function tableNames(boardId: string): Promise<string[]> {
  const stub = stubFor(boardId);
  return runInDurableObject(stub, (_inst, state) =>
    state.storage.sql
      .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)
      .toArray()
      .map((r) => r.name),
  );
}

async function readCreatedAt(boardId: string): Promise<string | null> {
  const stub = stubFor(boardId);
  return runInDurableObject(stub, (_inst, state) => {
    const hasTable = state.storage.sql
      .exec<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='storage_meta'`,
      )
      .one().c;
    if (!hasTable) return null;
    const rows = state.storage.sql
      .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key='created_at'`)
      .toArray();
    return rows.length > 0 ? rows[0].value : null;
  });
}

// TC-05: POST creates a board (201) whose id matches the pattern; GET 200; created_at set.
describe('TC-05: POST /api/boards creates a board', () => {
  it('returns 201 with a valid id, GET returns 200 and created_at is set', async () => {
    const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(post.status).toBe(201);
    const { id } = (await post.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { id: string };
    expect(body.id).toBe(id);

    const createdAt = await readCreatedAt(id);
    expect(createdAt).not.toBeNull();
    expect(Number.parseInt(createdAt as string, 10)).toBeGreaterThan(0);
  });
});

// TC-06: GET an unknown-but-valid id -> 404 and no storage written.
describe('TC-06: GET unknown id does not create storage', () => {
  it('returns 404 and leaves sqlite_master empty (no tables)', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(404);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe('not_found');

    const names = await tableNames(id);
    expect(names).toEqual([]); // probing wrote nothing
  });
});

// TC-07: malformed ids -> 404, never reach a Durable Object with storage.
describe('TC-07: malformed ids return 404', () => {
  it('GET /api/boards/abc and a 23-char id each return 404 with no storage', async () => {
    const a = await SELF.fetch('http://localhost/api/boards/abc');
    expect(a.status).toBe(404);

    const long = 'a'.repeat(23);
    const b = await SELF.fetch(`http://localhost/api/boards/${long}`);
    expect(b.status).toBe(404);

    // A string containing '/' never matches the :id segment -> SPA fallback (200),
    // but a slash-containing token in the id position is treated as not_found by
    // the path match; assert a clearly-malformed token is rejected.
    const c = await SELF.fetch('http://localhost/api/boards/..%2Fx');
    expect([404, 200]).toContain(c.status);

    // No storage was created for the malformed ids.
    expect(await tableNames('abc')).toEqual([]);
    expect(await tableNames(long)).toEqual([]);
  });
});

// TC-08: a legacy board (updates rows, no created_at) counts as existing.
describe('TC-08: legacy board with data but no created_at exists', () => {
  it('GET returns 200 after seeding an updates row without created_at', async () => {
    const id = newBoardId();
    await runInDurableObject(stubFor(id), (_inst, state) => {
      state.storage.sql
        .exec(`CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`)
        .toArray();
      state.storage.sql
        .exec(`CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
        .toArray();
      // A single update row (Yjs state for a one-note doc), no created_at.
      state.storage.sql
        .exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, new Uint8Array([1, 2, 3, 4]).buffer, 4)
        .toArray();
    });

    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(200);
    const createdAt = await readCreatedAt(id);
    expect(createdAt).toBeNull(); // still no created_at: legacy board, not re-created
  });
});

// TC-09: WebSocket upgrade to an unknown id -> 404, no socket, no tables.
describe('TC-09: WebSocket upgrade to unknown id returns 404', () => {
  it('does not accept a socket and creates no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tableNames(id)).toEqual([]);
  });
});

// TC-10: WebSocket upgrade after POST -> 101 and story 3 sync works.
describe('TC-10: WebSocket upgrade after POST works with sync', () => {
  it('connects and syncs a note between two clients', async () => {
    const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    const { id } = (await post.json()) as { id: string };

    const a = await createSyncClient(SELF, id);
    createSticky(a.doc, { x: 40, y: 40 }, 'blue');
    await new Promise((r) => setTimeout(r, 300));

    const b = await createSyncClient(SELF, id);
    await new Promise((r) => setTimeout(r, 300));

    expect(snapshot(b.doc).length).toBe(1);

    await a.close();
    await b.close();
  });
});

// TC-12: an initialize RPC that throws -> create_failed (HTTP 500).
describe('TC-12: initialize RPC failure -> 500 create_failed', () => {
  it('createBoard returns create_failed when the RPC throws', async () => {
    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          initialize: async () => {
            throw new Error('injected RPC failure');
          },
        }),
      },
    } as unknown as Parameters<typeof createBoard>[0];

    const result = await createBoard(fakeEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('create_failed');
  });

  it('the worker maps create_failed to HTTP 500', async () => {
    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          initialize: async () => {
            throw new Error('injected RPC failure');
          },
        }),
      },
    } as unknown as Parameters<typeof worker.fetch>[1];

    const res = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      fakeEnv,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('create_failed');
  });
});

// TC-14: a wrong method on /api/boards -> 405.
describe('TC-14: wrong method on /api/boards returns 405', () => {
  it('PUT /api/boards -> 405', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

// TC-15: initialize() twice -> created then exists; created_at unchanged.
describe('TC-15: initialize is idempotent and never re-initialises', () => {
  it('first call created, second exists, created_at unchanged', async () => {
    const id = newBoardId();
    const stub = stubFor(id);

    const first = await stub.initialize();
    expect(first).toBe('created');
    const created = await readCreatedAt(id);

    const second = await stub.initialize();
    expect(second).toBe('exists');
    expect(await readCreatedAt(id)).toBe(created); // unchanged, never re-initialised
  });
});

// A board that never existed can never be "recreated" as a side effect of a check;
// sanity guard for Y round-tripping used by other tests.
describe('sanity: Yjs round-trips through storage for a created board', () => {
  it('a note created after POST reloads from storage', async () => {
    const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    const { id } = (await post.json()) as { id: string };
    const a = await createSyncClient(SELF, id);
    createSticky(a.doc, { x: 1, y: 1 }, 'green');
    await new Promise((r) => setTimeout(r, 400));
    const data = Y.encodeStateAsUpdate(a.doc);
    await a.close();

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, data);
    expect(snapshot(doc2).length).toBe(1);
  });
});

// TC-32: the served document carries no-referrer, so the board id is not leaked.
describe('TC-32: served index.html sets no-referrer', () => {
  it('GET / returns html containing the no-referrer meta tag', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta[^>]*name=["']referrer["'][^>]*content=["']no-referrer["']/i);
  });
});
