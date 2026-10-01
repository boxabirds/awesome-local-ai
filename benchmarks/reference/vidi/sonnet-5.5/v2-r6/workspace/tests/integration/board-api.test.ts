import { env, exports as workerExports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import worker, { type Env } from '../../src/worker/index';
import { retroBoard } from '../fixtures/boards';
import { connect, fetchWorker, until } from './ws-client';

const BASE = 'https://example.com';
const ns = (env as unknown as { BOARD_ROOM: DurableObjectNamespace<BoardRoom> }).BOARD_ROOM;
const stubOf = (id: string) => ns.get(ns.idFromName(id));
const tables = (id: string) => runInDurableObject(stubOf(id), (_i, state) =>
  state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name));

describe('Board API', () => {
  it('TC-05: POST creates a board with a valid id; GET finds it; created_at is set', async () => {
    const res = await fetchWorker(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    expect((await fetchWorker(`${BASE}/api/boards/${id}`)).status).toBe(200);
    const createdAt = await runInDurableObject(stubOf(id), (_i, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value);
    expect(Number(createdAt)).toBeGreaterThan(0);
  });

  it('TC-06: GET for a never-created id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await fetchWorker(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07: malformed ids are 404 and never reach a Durable Object', async () => {
    const idFromName = vi.fn();
    const mocked = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    for (const bad of ['abc', `${newBoardId()}x`, `${newBoardId().slice(1)}`]) {
      const res = await worker.fetch(new Request(`${BASE}/api/boards/${bad}`), mocked);
      expect(res.status).toBe(404);
      expect((await fetchWorker(`${BASE}/api/boards/${bad}`)).status).toBe(404);
    }
    expect(idFromName).not.toHaveBeenCalled();
  });

  it('TC-08: a legacy board (updates, no created_at) exists', async () => {
    const id = newBoardId();
    const { updates } = retroBoard();
    await runInDurableObject(stubOf(id), (instance) => {
      instance.store.migrate();
      for (const u of updates) instance.store.append(u);
    });
    const hasCreatedAt = await runInDurableObject(stubOf(id), (_i, state) =>
      state.storage.sql.exec("SELECT 1 FROM storage_meta WHERE key = 'created_at'").toArray().length);
    expect(hasCreatedAt).toBe(0);
    expect((await fetchWorker(`${BASE}/api/boards/${id}`)).status).toBe(200);
  });

  it('TC-09: WebSocket upgrade to an unknown id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await fetchWorker(`${BASE}/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tables(id)).toEqual([]);
  });

  it('TC-10: upgrade after POST is accepted and sync works', async () => {
    const { id } = (await (await fetchWorker(`${BASE}/api/boards`, { method: 'POST' })).json()) as { id: string };
    const a = await connect(id);
    const b = await connect(id);
    createSticky(a.doc, { x: 1, y: 2 });
    await until(() => b.snapshot().length === 1, 5000, 'note on B');
    a.close();
    b.close();
  });

  it('TC-12: initialize throwing → 500 create_failed', async () => {
    const failing = {
      BOARD_ROOM: { idFromName: () => 'x', get: () => ({ initialize: () => Promise.reject(new Error('boom')) }) },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env;
    const res = await worker.fetch(new Request(`${BASE}/api/boards`, { method: 'POST' }), failing);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-12b: initialize reporting an existing board → 500 create_failed (no retry)', async () => {
    const exists = {
      BOARD_ROOM: { idFromName: () => 'x', get: () => ({ initialize: () => Promise.resolve('exists') }) },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env;
    const res = await worker.fetch(new Request(`${BASE}/api/boards`, { method: 'POST' }), exists);
    expect(res.status).toBe(500);
  });

  it('TC-14: other methods on /api/boards → 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      expect((await fetchWorker(`${BASE}/api/boards`, { method })).status).toBe(405);
    }
  });

  it('TC-15: initialize twice → created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const read = () => runInDurableObject(stubOf(id), (_i, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value);
    expect(await stubOf(id).initialize()).toBe('created');
    const first = await read();
    await new Promise((r) => setTimeout(r, 5));
    expect(await stubOf(id).initialize()).toBe('exists');
    expect(await read()).toBe(first);
  });

  it('TC-32: served index.html has the no-referrer meta', async () => {
    const res = await (workerExports as unknown as { default: Fetcher }).default.fetch(`${BASE}/b/${newBoardId()}`);
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer"');
  });
});
