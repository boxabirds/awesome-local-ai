// TC-05–TC-10, TC-12, TC-14, TC-15, TC-32 (story 5): the board API on the
// Worker — creation, read-only existence, and the unknown-board 404s.
//
// The Durable Object namespace and SELF.fetch are the test environment's real
// bindings: requests here run the production entrypoint, including its
// validation before any object is instantiated.

import { describe, it, expect, vi } from 'vitest';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { BoardStore, META_CREATED_AT } from '../../src/worker/board-store';
import { createWsClient } from './ws-client';

const BASE = 'http://127.0.0.1';

function boardStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error('pollUntil: condition not met within timeout');
}

/** The names of the tables in this board's database (empty for unknown boards). */
function tablesFor(boardId: string): Promise<Set<string>> {
  return runInDurableObject(boardStub(boardId), (_instance, state) => {
    const rows = state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray();
    return new Set(rows.map((row) => row.name));
  });
}

/** The board's storage_meta.created_at, or null when absent. */
function createdAt(boardId: string): Promise<string | null> {
  return runInDurableObject(boardStub(boardId), (_instance, state) => {
    const row = state.storage.sql
      .exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?1',
        META_CREATED_AT,
      )
      .next();
    return row.done ? null : row.value.value;
  });
}

/** A small board update (one sticky) for seeding legacy fixtures. */
function stickyUpdate(): Uint8Array {
  const doc = new Y.Doc();
  createSticky(doc, { x: 5, y: 6 }, 'blue');
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe('Board API (share.board_api, share.not_found)', () => {
  it('TC-05: POST /api/boards → 201 {id: 22-char link code}; GET → 200; created_at set', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`${BASE}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect((await get.json()) as { id: string }).toEqual({ id: body.id });

    const created = await createdAt(body.id);
    expect(created).not.toBeNull();
    expect(Number(created)).not.toBeNaN();
  });

  it('TC-06: GET /api/boards/:id for a never-created id → 404 not_found; no storage created', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });
    // The read-only check must not have created the object's tables.
    expect(await tablesFor(id)).toEqual(new Set());
  });

  it('TC-07: GET /api/boards/:id for malformed ids → 404, with no RPC call at all', async () => {
    const getSpy = vi.spyOn(env.BOARD_ROOM, 'get');
    for (const bad of ['a'.repeat(23), 'a'.repeat(21), 'abc', 'a'.repeat(21) + '+']) {
      const res = await SELF.fetch(`${BASE}/api/boards/${bad}`);
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });
    }
    // Validation happens before the namespace is touched: no object
    // instantiation, no RPC.
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('TC-08: legacy board (story-4 schema, updates row, no created_at) → 200', async () => {
    const id = newBoardId();
    // Seed the pre-story-5 layout directly in storage: the story 4 schema and
    // an updates row, but no storage_meta.created_at.
    await runInDurableObject(boardStub(id), (_instance, state) => {
      new BoardStore(state.storage).seedLegacy(stickyUpdate());
    });
    expect(await createdAt(id)).toBeNull();

    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toEqual({ id });
  });

  it('TC-09: WebSocket upgrade to an unknown board → 404, no socket, no storage', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tablesFor(id)).toEqual(new Set());
  });

  it('TC-10: the board returned by POST opens — upgrade → 101 and story 3 sync works', async () => {
    const created = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const upgrade = await SELF.fetch(`${BASE}/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(upgrade.status).toBe(101);

    // Story 3 behaviour over the accepted socket: a note created by A is
    // visible to B.
    const a = await createWsClient(id);
    const b = await createWsClient(id);
    const noteId = createSticky(a.doc, { x: 10, y: 10 }, 'blue');
    expect(noteId).not.toBeNull();
    await pollUntil(() => snapshot(b.doc).length === 1);
    expect(snapshot(b.doc)[0].id).toBe(noteId);
    a.close();
    b.close();
  });

  it('TC-12: an initialize() that throws → 500 create_failed; an "exists" for a fresh id → 500 create_failed', async () => {
    // (a) initialize() throws → create_failed.
    const failingSpy = vi.spyOn(env.BOARD_ROOM, 'get');
    failingSpy.mockReturnValue({
      initialize: async () => {
        throw new Error('injected RPC failure');
      },
    } as never);
    const failing = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(failing.status).toBe(500);
    expect((await failing.json()) as { error: string }).toEqual({ error: 'create_failed' });
    failingSpy.mockRestore();

    // (b) initialize() returns "exists" for a freshly generated id → create_failed.
    const existsSpy = vi.spyOn(env.BOARD_ROOM, 'get');
    existsSpy.mockReturnValue({
      initialize: async () => 'exists',
    } as never);
    const exists = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(exists.status).toBe(500);
    expect((await exists.json()) as { error: string }).toEqual({ error: 'create_failed' });
    existsSpy.mockRestore();
  });

  it('TC-14: PUT /api/boards → 405 (creation is POST-only)', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize() twice on the same object → "created" then "exists", created_at unchanged', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(boardStub(id), async (_instance, state) => {
      const first = await _instance.initialize();
      const afterFirst = await runCreatedAt(state);
      const second = await _instance.initialize();
      const afterSecond = await runCreatedAt(state);
      return { first, second, afterFirst, afterSecond };
    });
    expect(result.first).toBe('created');
    expect(result.second).toBe('exists');
    expect(result.afterFirst).not.toBeNull();
    expect(result.afterFirst).toBe(result.afterSecond);
  });

  it('TC-32: the served index.html carries <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer" />');
  });
});

async function runCreatedAt(state: DurableObjectState): Promise<string | null> {
  const row = state.storage.sql
    .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?1', META_CREATED_AT)
    .next();
  return row.done ? null : row.value.value;
}
