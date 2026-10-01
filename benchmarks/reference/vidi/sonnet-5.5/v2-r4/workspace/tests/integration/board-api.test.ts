import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import worker from '../../src/worker/index';
import { retroBoard25 } from '../fixtures/boards';
import { WsClient, upgrade, waitFor } from './ws-client';

const stubFor = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
const get = (id: string) => exports.default.fetch(`http://example.com/api/boards/${id}`);
const post = () => exports.default.fetch('http://example.com/api/boards', { method: 'POST' });

const tables = (id: string) =>
  runInDurableObject(stubFor(id), (_room, state) =>
    state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => String(r.name)),
  );

describe('board API', () => {
  it('TC-05: POST creates a board with a valid id; GET finds it; created_at is set', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    const found = await get(id);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ id });
    const createdAt = await runInDurableObject(stubFor(id), (_room, state) =>
      state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray(),
    );
    expect(createdAt).toHaveLength(1);
    expect(Number(createdAt[0].value)).toBeGreaterThan(0);
  });

  it('TC-06: GET for a never-created id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07: malformed ids are 404 and never reach the namespace', async () => {
    for (const bad of ['abc', 'a'.repeat(23), 'a'.repeat(21), '..%2Fx']) {
      const res = await get(bad);
      expect(res.status).toBe(404);
    }
    const idFromName = vi.fn();
    const fake = { BOARD_ROOM: { idFromName, get: idFromName }, ASSETS: env.ASSETS } as unknown as Parameters<typeof worker.fetch>[1];
    for (const bad of ['abc', 'a'.repeat(23)]) {
      const res = await worker.fetch(new Request(`http://example.com/api/boards/${bad}`), fake);
      expect(res.status).toBe(404);
    }
    expect(idFromName).not.toHaveBeenCalled();
  });

  it('TC-08: a legacy board (saved updates, no created_at) exists', async () => {
    const id = newBoardId();
    const board = retroBoard25();
    await runInDurableObject(stubFor(id), (_room, state) => {
      const store = new BoardStore(state.storage as never);
      store.migrate();
      store.append(board.updates[0]);
    });
    expect((await get(id)).status).toBe(200);
    const c = await WsClient.connect(id, { create: false });
    expect(c.synced).toBe(true);
    c.close();
  });

  it('TC-09: a WebSocket upgrade to an unknown id is 404, accepts no socket and writes no storage', async () => {
    const id = newBoardId();
    const res = await upgrade(id);
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tables(id)).toEqual([]);
  });

  it('TC-10: the upgrade after POST is 101 and sync works', async () => {
    const { id } = (await (await post()).json()) as { id: string };
    const a = await WsClient.connect(id, { create: false });
    const b = await WsClient.connect(id, { create: false });
    const noteId = createSticky(a.doc, { x: 3, y: 4 });
    await waitFor(() => b.snapshot().some((n) => n.id === noteId), 'note on B');
  });

  it('TC-12: initialize throwing → 500 create_failed', async () => {
    const fake = {
      BOARD_ROOM: {
        idFromName: () => 'x',
        get: () => ({
          initialize: () => {
            throw new Error('boom');
          },
        }),
      },
      ASSETS: env.ASSETS,
    } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('http://example.com/api/boards', { method: 'POST' }), fake);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-14: other methods on /api/boards are 405', async () => {
    const res = await exports.default.fetch('http://example.com/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize twice → created then exists; created_at unchanged', async () => {
    const stub = stubFor(newBoardId());
    const read = () =>
      runInDurableObject(stub, (_room, state) =>
        String(state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").one().value),
      );
    expect(await stub.initialize()).toBe('created');
    const first = await read();
    await new Promise((r) => setTimeout(r, 5));
    expect(await stub.initialize()).toBe('exists');
    expect(await read()).toBe(first);
  });

  it('TC-32: the served index.html tells browsers not to send a referrer', async () => {
    const res = await exports.default.fetch('http://example.com/');
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer"');
  });
});
