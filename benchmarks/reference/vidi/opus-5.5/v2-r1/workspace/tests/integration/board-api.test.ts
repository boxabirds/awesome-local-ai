// share.board_api: the real Worker, Durable Object RPC and SQLite storage.
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import type { BoardRoom } from '../../src/worker/board-room';
import worker from '../../src/worker/index';
import { retroBoard } from '../fixtures/boards';
import { TestClient, createBoardId, roomUrl } from './ws-client';

const BASE = 'http://example.com';
const stubOf = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

/** User tables in the board's SQLite database (the runtime's own `_cf_*` tables excluded). */
function tables(id: string) {
  return runInDurableObject(stubOf(id), (_room, state) =>
    state.storage.sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'`,
      )
      .toArray()
      .map((r) => r.name),
  );
}

function createdAt(id: string) {
  return runInDurableObject(stubOf(id), (_room, state) =>
    state.storage.sql
      .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
      .toArray()
      .map((r) => Number(r.value))[0],
  );
}

/** The real namespace, wrapped to record every use. */
function spiedNamespace() {
  const calls: string[] = [];
  const ns = new Proxy(env.BOARD_ROOM, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return value.apply(target, args);
      };
    },
  });
  return { ns, calls };
}

const open: TestClient[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('share.board_api', () => {
  it('TC-05 POST /api/boards creates a board: 201 id, GET 200, created_at stored', async () => {
    const before = Date.now();
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id });

    const at = await createdAt(id);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('TC-06 GET of a never-created id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07 malformed ids are 404 without reaching the namespace', async () => {
    const { ns, calls } = spiedNamespace();
    const id = newBoardId();
    for (const bad of ['abc', id.slice(1), `${id}A`, `${id.slice(0, 10)}%2F${id.slice(11)}`, `${id}/x`]) {
      const res = await worker.fetch(new Request(`${BASE}/api/boards/${bad}`), { ...env, BOARD_ROOM: ns });
      expect(res.status, bad).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(calls).toEqual([]);
  });

  it('TC-08 a legacy board (saved updates, no created_at) exists', async () => {
    const id = newBoardId();
    await runInDurableObject(stubOf(id), (room: BoardRoom) => {
      const store = room['store'];
      store.migrate();
      for (const u of retroBoard().updates) store.append(u);
    });
    expect(await createdAt(id)).toBeUndefined();
    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(200);
  });

  it('TC-09 a WebSocket upgrade to an unknown board is 404: no socket, no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(roomUrl(id), { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tables(id)).toEqual([]);
    const sockets = await runInDurableObject(stubOf(id), (_room, state) => state.getWebSockets().length);
    expect(sockets).toBe(0);

    // Malformed ids on the room route are 404 as well (was 400 in story 3).
    const bad = await SELF.fetch(roomUrl('abc'), { headers: { Upgrade: 'websocket' } });
    expect(bad.status).toBe(404);
  });

  it('TC-10 a WebSocket upgrade after POST is 101 and syncs as in story 3', async () => {
    const id = await createBoardId();
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    open.push(a, b);
    expect(a.status).toBe(101);
    const noteId = createSticky(a.doc, { x: 1, y: 2 });
    await expect.poll(() => b.snapshot().map((n) => n.id)).toEqual([noteId]);
  });

  it('TC-12 POST answers 500 create_failed when initialize throws', async () => {
    const failing = new Proxy(env.BOARD_ROOM, {
      get(target, prop, receiver) {
        if (prop === 'get') {
          return () => ({
            initialize: async () => {
              throw new Error('injected RPC failure');
            },
          });
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const original = console.error;
    console.error = () => {};
    try {
      const res = await worker.fetch(new Request(`${BASE}/api/boards`, { method: 'POST' }), {
        ...env,
        BOARD_ROOM: failing,
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'create_failed' });
    } finally {
      console.error = original;
    }
  });

  it('TC-14 other methods on /api/boards are 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE', 'PATCH']) {
      const res = await SELF.fetch(`${BASE}/api/boards`, { method });
      expect(res.status, method).toBe(405);
    }
  });

  it('TC-15 initialize() twice: created then exists, created_at unchanged', async () => {
    const id = newBoardId();
    const stub = stubOf(id);
    expect(await stub.initialize()).toBe('created');
    const first = await createdAt(id);
    await new Promise((r) => setTimeout(r, 5));
    expect(await stub.initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(first);
    expect(await stub.exists()).toBe(true);
  });

  it('TC-32 the served page tells the browser never to send a Referer', async () => {
    const res = await SELF.fetch(`${BASE}/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
