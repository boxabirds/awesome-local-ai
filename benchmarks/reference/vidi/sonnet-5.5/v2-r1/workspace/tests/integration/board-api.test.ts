import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/index';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { recordUpdates } from '../fixtures/boards';
import { WsClient } from './ws-client';

const stubFor = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
const get = (path: string) => SELF.fetch(`https://example.com${path}`);
const tableCount = (id: string) =>
  runInDurableObject(stubFor(id), (_i, state) =>
    state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().length,
  );

describe('board API', () => {
  it('TC-05: POST creates a board with a valid id; GET finds it; created_at is set', async () => {
    const res = await SELF.fetch('https://example.com/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    expect((await get(`/api/boards/${id}`)).status).toBe(200);
    const createdAt = await runInDurableObject(stubFor(id), (_i, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value,
    );
    expect(Number(createdAt)).toBeGreaterThan(0);
  });

  it('TC-06: GET for a never-created id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await get(`/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tableCount(id)).toBe(0);
  });

  it('TC-07: malformed ids are 404 and never reach a Durable Object', async () => {
    for (const bad of ['abc', 'a'.repeat(23), 'a'.repeat(21)]) {
      expect((await get(`/api/boards/${bad}`)).status).toBe(404);
    }
    const idFromName = vi.fn();
    const stubGet = vi.fn();
    const fake = { BOARD_ROOM: { idFromName, get: stubGet }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    const res = await worker.fetch(new Request('https://example.com/api/boards/abc'), fake);
    expect(res.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    expect(stubGet).not.toHaveBeenCalled();
  });

  it('TC-08: a legacy board (updates row, no created_at) exists', async () => {
    const id = newBoardId();
    const { updates } = recordUpdates((doc) => createSticky(doc, { x: 1, y: 2 }));
    await runInDurableObject(stubFor(id), (_i, state) => {
      const sql = state.storage.sql;
      sql.exec('CREATE TABLE storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      sql.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
      sql.exec('CREATE TABLE snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', updates[0].slice(), updates[0].length);
    });
    expect((await get(`/api/boards/${id}`)).status).toBe(200);
  });

  it('TC-09: WebSocket upgrade to an unknown id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`https://example.com/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tableCount(id)).toBe(0);
  });

  it('TC-10: upgrade after POST is accepted and syncs', async () => {
    const { id } = (await (await SELF.fetch('https://example.com/api/boards', { method: 'POST' })).json()) as { id: string };
    const a = await WsClient.connect(id, undefined, false);
    const b = await WsClient.connect(id, undefined, false);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 5, y: 5 });
    const { waitFor } = await import('./ws-client');
    await waitFor(() => b.snapshotJson === a.snapshotJson && JSON.parse(b.snapshotJson).length === 1, 'sync');
    a.close();
    b.close();
  });

  it('TC-12: initialize throwing gives 500 create_failed', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('boom'));
    const fake = {
      BOARD_ROOM: { idFromName: vi.fn(), get: vi.fn(() => ({ initialize })) },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env;
    const res = await worker.fetch(new Request('https://example.com/api/boards', { method: 'POST' }), fake);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-14: other methods on /api/boards are 405', async () => {
    expect((await SELF.fetch('https://example.com/api/boards', { method: 'PUT' })).status).toBe(405);
    expect((await get('/api/boards')).status).toBe(405);
  });

  it('TC-15: initialize twice returns created then exists; created_at unchanged', async () => {
    const stub = stubFor(newBoardId());
    const read = () =>
      runInDurableObject(stub, (_i, state) =>
        state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value,
      );
    expect(await stub.initialize()).toBe('created');
    const first = await read();
    await new Promise((r) => setTimeout(r, 5));
    expect(await stub.initialize()).toBe('exists');
    expect(await read()).toBe(first);
  });

  it('TC-32: served index.html has the no-referrer policy', async () => {
    const res = await get('/');
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer"');
  });
});
