import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import { createBoard } from '../../src/worker/create-board';
import worker from '../../src/worker/index';
import { WsClient } from './helpers/ws-client';

const HOST = 'http://example.com';
const upgrade = { headers: { Upgrade: 'websocket' } };
const stubOf = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
const tables = (id: string) => runInDurableObject(stubOf(id), (_r: BoardRoom, state) =>
  state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\'").toArray());

describe('board API (share.board_api)', () => {
  it('TC-05 POST creates a board that GET then finds, with created_at set', async () => {
    const res = await SELF.fetch(`${HOST}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    expect((await SELF.fetch(`${HOST}/api/boards/${id}`)).status).toBe(200);
    const createdAt = await runInDurableObject(stubOf(id), (_r: BoardRoom, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value);
    expect(Number(createdAt)).toBeGreaterThan(0);
  });

  it('TC-06 GET for a never-created id → 404 and nothing is written', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${HOST}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07 malformed ids → 404 and the Durable Object is never called', async () => {
    const idFromName = vi.fn();
    const fakeEnv = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: env.ASSETS } as never;
    for (const bad of ['abc', 'A'.repeat(23), 'A'.repeat(21), `${'A'.repeat(21)}/`]) {
      const res = await worker.fetch(new Request(`${HOST}/api/boards/${bad}`), fakeEnv);
      expect(res.status).toBe(404);
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect((await SELF.fetch(`${HOST}/api/boards/abc`)).status).toBe(404);
    expect((await SELF.fetch(`${HOST}/api/boards/${'A'.repeat(23)}`)).status).toBe(404);
  });

  it('TC-08 legacy board (saved updates, no created_at) counts as existing', async () => {
    const id = newBoardId();
    await runInDurableObject(stubOf(id), (room: BoardRoom, state) => {
      room.store.migrate();
      room.store.append(new Uint8Array([0, 0]));
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM storage_meta WHERE key = 'created_at'").one().n).toBe(0);
    });
    expect((await SELF.fetch(`${HOST}/api/boards/${id}`)).status).toBe(200);
  });

  it('TC-09 WebSocket upgrade to an unknown id → 404, no socket, no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${HOST}/api/rooms/${id}`, upgrade);
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tables(id)).toEqual([]);
    expect((await SELF.fetch(`${HOST}/api/rooms/bad!id`, upgrade)).status).toBe(404);
  });

  it('TC-10 upgrade after POST → 101 and sync works', async () => {
    const { id } = (await (await SELF.fetch(`${HOST}/api/boards`, { method: 'POST' })).json()) as { id: string };
    const res = await SELF.fetch(`${HOST}/api/rooms/${id}`, upgrade);
    expect(res.status).toBe(101);
    res.webSocket!.accept();
    res.webSocket!.close(1000);
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 1, y: 2 });
    await vi.waitUntil(() => b.snapshot().length === 1, { timeout: 10_000 });
    a.close();
    b.close();
  });

  it('TC-12 initialize throwing → 500 create_failed', async () => {
    const throwing = {
      BOARD_ROOM: { idFromName: () => 'x', get: () => ({ initialize: () => { throw new Error('boom'); } }) },
      ASSETS: env.ASSETS,
    } as never;
    const res = await worker.fetch(new Request(`${HOST}/api/boards`, { method: 'POST' }), throwing);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
    expect(await createBoard(throwing)).toEqual({ ok: false, reason: 'create_failed' });
  });

  it('TC-14 other methods on /api/boards → 405', async () => {
    expect((await SELF.fetch(`${HOST}/api/boards`, { method: 'PUT' })).status).toBe(405);
    expect((await SELF.fetch(`${HOST}/api/boards`)).status).toBe(405);
  });

  it('TC-15 initialize twice → created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const read = () => runInDurableObject(stubOf(id), (_r: BoardRoom, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value);
    expect(await stubOf(id).initialize()).toBe('created');
    const first = await read();
    await new Promise((r) => setTimeout(r, 5));
    expect(await stubOf(id).initialize()).toBe('exists');
    expect(await read()).toBe(first);
  });

  it('TC-32 served index.html sends no referrer', async () => {
    const res = await SELF.fetch(`${HOST}/b/${newBoardId()}`, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer"');
  });
});
