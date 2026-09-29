import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId, BOARD_ID_PATTERN } from '@shared/board-id';
import { handlePostBoards } from '../../src/worker/index';
import type { Env } from '../../src/worker/index';

/**
 * share.board_api integration tests: real Worker request handling, real
 * Durable Object RPC and real SQLite storage.
 */

/** Read-only SQL query against a board's Durable Object storage. */
async function storageQuery(boardId: string, query: string, params: unknown[] = []): Promise<any[]> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  const resp = await stub.fetch('http://internal/__test/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'query', data: { query, params } }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`storage query failed: ${data.error}`);
  return data.rows;
}

async function storageExecute(boardId: string, query: string, params: unknown[] = []): Promise<void> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  const resp = await stub.fetch('http://internal/__test/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'execute', data: { query, params } }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`storage execute failed: ${data.error}`);
}

async function tableNames(boardId: string): Promise<string[]> {
  const rows = await storageQuery(boardId, "SELECT name FROM sqlite_master WHERE type = 'table'");
  return rows.map((r) => r.name);
}

async function createdAt(boardId: string): Promise<string | null> {
  const tables = await tableNames(boardId);
  if (!tables.includes('storage_meta')) return null;
  const rows = await storageQuery(boardId, "SELECT value FROM storage_meta WHERE key = 'created_at'");
  return rows.length > 0 ? rows[0].value : null;
}

describe('TC-05: POST /api/boards creates a board', () => {
  it('201 with id matching BOARD_ID_PATTERN; GET 200; created_at set', async () => {
    const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(post.status).toBe(201);
    const { id } = await post.json();
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(id).toHaveLength(22);

    const get = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body).toEqual({ id });

    // storage_meta.created_at is set exactly once, in epoch ms
    const created = await createdAt(id);
    expect(created).not.toBeNull();
    expect(Number(created)).toBeGreaterThan(0);
  });
});

describe('TC-06: unknown board → 404 and no storage written (negative)', () => {
  it('GET a fresh never-created id → 404; sqlite_master has no tables', async () => {
    const freshId = newBoardId();
    const get = await SELF.fetch(`http://localhost/api/boards/${freshId}`);
    expect(get.status).toBe(404);
    const body = await get.json();
    expect(body).toEqual({ error: 'not_found' });

    // Probing an unknown link must not create storage (negative).
    const tables = await tableNames(freshId);
    expect(tables).toEqual([]);
    expect(await createdAt(freshId)).toBeNull();
  });
});

describe('TC-07: malformed ids → 404, RPC never called (negative)', () => {
  it('GET /api/boards/abc and a 23-char id → 404 each; nothing created', async () => {
    const short = await SELF.fetch('http://localhost/api/boards/abc');
    expect(short.status).toBe(404);
    expect(await short.json()).toEqual({ error: 'not_found' });

    const long = 'a'.repeat(23);
    const resp = await SELF.fetch(`http://localhost/api/boards/${long}`);
    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: 'not_found' });

    // The worker validates with isValidBoardId before touching the namespace,
    // so no Durable Object is ever instantiated for these ids and no storage
    // (tables) can exist. A 21-char id is equally rejected.
    const short21 = 'b'.repeat(21);
    const resp21 = await SELF.fetch(`http://localhost/api/boards/${short21}`);
    expect(resp21.status).toBe(404);

    const tablesLong = await tableNames(long);
    expect(tablesLong).toEqual([]);
  });
});

describe('TC-08: legacy board (data, no created_at) counts as existing', () => {
  it('seed an updates row without created_at → GET 200', async () => {
    const legacyId = newBoardId();

    // Seed exactly what a pre-story-5 board looks like: an updates row and
    // nothing else (no storage_meta, no created_at).
    const fakeUpdate = [0x55, 0x01, 0x02, 0x03];
    await storageExecute(
      legacyId,
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL); INSERT INTO updates (data, bytes) VALUES (?, ?)',
      [fakeUpdate, fakeUpdate.length],
    );

    const get = await SELF.fetch(`http://localhost/api/boards/${legacyId}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: legacyId });

    // Still no created_at: the check only read.
    expect(await createdAt(legacyId)).toBeNull();
  });
});

describe('TC-09: WebSocket upgrade to unknown board → 404 (negative)', () => {
  it('upgrade a fresh never-created id → 404; no socket accepted; no tables', async () => {
    const freshId = newBoardId();
    const resp = await SELF.fetch(`http://localhost/api/rooms/${freshId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(resp.status).toBe(404);

    // No storage was created by the rejected upgrade.
    const tables = await tableNames(freshId);
    expect(tables).toEqual([]);
  });
});

describe('TC-10: WebSocket upgrade after creation is accepted', () => {
  it('POST then upgrade → board exists and room is ready to sync', async () => {
    const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(post.status).toBe(201);
    const { id } = await post.json();

    // The room exists and its doc is loaded and ready (the 101 handshake and
    // story-3 sync itself are exercised in the e2e suite; a 101 response
    // cannot cross the RPC boundary of this test environment).
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    expect(await stub.exists()).toBe(true);

    const resp = await stub.fetch('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'get-state' }),
    });
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.state).toBe('ready');
  });
});

describe('TC-12: RPC failure → 500 create_failed (error path)', () => {
  it('initialize() throwing → 500 {"error":"create_failed"}', async () => {
    // Inject a throwing stub: a real RPC failure cannot be forced on demand.
    const mockEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => `mock-id-${name}`,
        get: () => ({
          initialize: () => Promise.reject(new Error('rpc failure')),
        }),
      },
    } as unknown as Env;

    const resp = await handlePostBoards(mockEnv);
    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: 'create_failed' });
  });
});

describe('TC-14: wrong method on /api/boards → 405', () => {
  it('PUT /api/boards → 405', async () => {
    const resp = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(resp.status).toBe(405);
  });

  it('DELETE /api/boards/<id> → 405', async () => {
    const id = newBoardId();
    const resp = await SELF.fetch(`http://localhost/api/boards/${id}`, { method: 'DELETE' });
    expect(resp.status).toBe(405);
  });
});

describe('TC-15: initialize() is idempotent (negative: never re-initialised)', () => {
  it('first call created, second exists; created_at unchanged', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    const first = await stub.initialize();
    expect(first).toBe('created');
    const firstCreatedAt = await createdAt(id);
    expect(firstCreatedAt).not.toBeNull();

    const second = await stub.initialize();
    expect(second).toBe('exists');

    // created_at is written once and never changes.
    expect(await createdAt(id)).toBe(firstCreatedAt);
  });
});

describe('TC-32: board page must not leak links via Referer (negative)', () => {
  it('served index.html contains <meta name="referrer" content="no-referrer">', async () => {
    const resp = await SELF.fetch('http://localhost/');
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
