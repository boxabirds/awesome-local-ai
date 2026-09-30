// Board creation and existence API (story 5, share.board_api) against the real
// Worker, Durable Object RPC and SQLite.
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import type { BoardRoom } from '../../src/worker/board-room';
import { retroBoard } from '../fixtures/boards';
import { TestClient, createBoardId, openSocket, waitFor } from './ws-client';

const BASE = 'http://vidi6.test';
const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  vi.restoreAllMocks();
});

function stubFor(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** User tables in the board's SQLite database (the platform's own `_cf_*` tables excluded). */
function tablesOf(boardId: string): Promise<string[]> {
  return runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((r) => r.name)
      .filter((n) => !n.startsWith('_cf_') && !n.startsWith('sqlite_')),
  );
}

function createdAt(boardId: string): Promise<string | undefined> {
  return runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'created_at'")
      .toArray()[0]?.value,
  );
}

describe('POST /api/boards (share.create)', () => {
  it('TC-05: 201 with a well-formed id; GET that id → 200; created_at is stored', async () => {
    const before = Date.now();
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);
    const get = await SELF.fetch(`${BASE}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: body.id });
    const at = Number(await createdAt(body.id));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('TC-12: initialize throwing → 500 create_failed', async () => {
    vi.spyOn(env.BOARD_ROOM, 'get').mockReturnValue({
      initialize: () => Promise.reject(new Error('injected RPC failure')),
    } as unknown as DurableObjectStub<BoardRoom>);
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-12: initialize returning exists for the fresh id → 500 create_failed (no retry)', async () => {
    const initialize = vi.fn(() => Promise.resolve('exists'));
    vi.spyOn(env.BOARD_ROOM, 'get').mockReturnValue({ initialize } as unknown as DurableObjectStub<BoardRoom>);
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('TC-14: other methods on /api/boards → 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      const res = await SELF.fetch(`${BASE}/api/boards`, { method });
      expect(res.status, method).toBe(405);
      await res.arrayBuffer();
    }
  });

  it('TC-15: initialize() twice → created then exists; created_at unchanged', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    expect(await stub.initialize()).toBe('created');
    const first = await createdAt(boardId);
    await new Promise((r) => setTimeout(r, 5));
    expect(await stub.initialize()).toBe('exists');
    expect(await createdAt(boardId)).toBe(first);
  });
});

describe('GET /api/boards/:id (share.open_link, share.not_found)', () => {
  it('TC-06: a never-created id → 404 and no storage is written', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tablesOf(boardId)).toEqual([]);
  });

  it('TC-07: malformed ids → 404 without reaching a Durable Object', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const get = vi.spyOn(env.BOARD_ROOM, 'get');
    for (const bad of ['abc', 'A'.repeat(21), 'A'.repeat(23), 'AbCdEfGhIjKl%2FnOpQr_-09']) {
      const res = await SELF.fetch(`${BASE}/api/boards/${bad}`);
      expect(res.status, bad).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-08: a legacy board (saved updates, no created_at) → 200', async () => {
    const boardId = newBoardId();
    const update = Y.encodeStateAsUpdate(retroBoard());
    await runInDurableObject(stubFor(boardId), (_room, state) => {
      const sql = state.storage.sql;
      sql.exec('CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      sql.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
      sql.exec('CREATE TABLE snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      sql.exec("INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', '1')");
      sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update.slice().buffer, update.byteLength);
    });
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}`);
    expect(res.status).toBe(200);
    expect(await createdAt(boardId)).toBeUndefined();
  });

  it('TC-08 control: tables without content (created, never used, pre-story-5) do not count as a board', async () => {
    const boardId = newBoardId();
    await runInDurableObject(stubFor(boardId), (_room, state) => {
      state.storage.sql.exec('CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      state.storage.sql.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    });
    expect((await SELF.fetch(`${BASE}/api/boards/${boardId}`)).status).toBe(404);
  });

  it('other methods on /api/boards/:id → 405', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards/${newBoardId()}`, { method: 'POST' });
    expect(res.status).toBe(405);
    await res.arrayBuffer();
  });
});

describe('WebSocket /api/rooms/:id (share.not_found)', () => {
  it('TC-09: upgrade to a never-created id → 404, no socket, no tables', async () => {
    const boardId = newBoardId();
    const { status, ws } = await openSocket(boardId);
    expect(status).toBe(404);
    expect(ws).toBeNull();
    expect(await tablesOf(boardId)).toEqual([]);
    const sockets = await runInDurableObject(stubFor(boardId), (_room, state) => state.getWebSockets().length);
    expect(sockets).toBe(0);
  });

  it('TC-10: upgrade after POST → 101 and live sync works', async () => {
    const boardId = await createBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    clients.push(a, b);
    const id = createSticky(a.doc, { x: 5, y: 5 });
    await waitFor(() => b.snapshot().some((n) => n.id === id), 'note reaches B');
  });

  it('TC-10: a legacy board still accepts connections and serves its notes', async () => {
    const boardId = newBoardId();
    const source = retroBoard();
    const update = Y.encodeStateAsUpdate(source);
    await runInDurableObject(stubFor(boardId), (_room, state) => {
      const sql = state.storage.sql;
      sql.exec('CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      sql.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
      sql.exec('CREATE TABLE snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      sql.exec('CREATE TABLE quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
      sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update.slice().buffer, update.byteLength);
      (_room as unknown as { load(): void }).load();
    });
    const c = await TestClient.connect(boardId);
    clients.push(c);
    expect(c.snapshot()).toHaveLength(25);
  });
});

describe('Privacy (share constraints)', () => {
  it('TC-32: served index.html carries <meta name="referrer" content="no-referrer">', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    }
  });
});
