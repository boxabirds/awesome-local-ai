// Story 5 — board creation and existence API (share.board_api) against the real
// Worker, Durable Object RPC and SQLite: TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BoardStore } from '../../src/worker/board-store';
import { createBoard } from '../../src/worker/create-board';
import worker, { type Env } from '../../src/worker/index';
import { retroBoard } from '../fixtures/boards';
import { inRoom, roomStub } from './storage-helpers';
import { ORIGIN, TestClient, createBoardId, waitForConvergence } from './ws-client';

const clients: TestClient[] = [];

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  vi.restoreAllMocks();
});

function tables(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .toArray()
    .map((r) => r.name);
}

function createdAt(storage: DurableObjectStorage): string | undefined {
  return storage.sql
    .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'created_at'")
    .toArray()[0]?.value;
}

async function getBoard(id: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${id}`);
}

/** An Env whose room stub is replaced (RPC failure injection); the Worker code is real. */
function envWithRoom(stub: Partial<Record<'initialize' | 'exists' | 'fetch', (...args: unknown[]) => unknown>>): Env {
  return {
    ...env,
    BOARD_ROOM: {
      idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
      get: () => stub,
    } as unknown as Env['BOARD_ROOM'],
  };
}

describe('POST /api/boards (share.create)', () => {
  it('TC-05: creates a board: 201 with an id matching BOARD_ID_PATTERN; GET 200; created_at stored', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);
    const get = await getBoard(body.id);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: body.id });
    const stored = await inRoom(body.id, (_room, storage) => createdAt(storage));
    expect(Number(stored)).toBeGreaterThan(0);
  });

  it('TC-12: initialize throwing → 500 create_failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = envWithRoom({
      initialize: () => Promise.reject(new Error('injected RPC failure')),
    });
    const response = await worker.fetch(new Request(`${ORIGIN}/api/boards`, { method: 'POST' }), failing);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });
  });

  it('TC-12: initialize reporting exists for a fresh id (collision) → 500, no retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const initialize = vi.fn(() => Promise.resolve('exists'));
    const result = await createBoard(envWithRoom({ initialize }));
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('TC-14: other methods on /api/boards → 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      const response = await SELF.fetch(`${ORIGIN}/api/boards`, { method });
      expect(response.status, method).toBe(405);
      await response.body?.cancel();
    }
  });

  it('TC-15: initialize() twice → created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    expect(await roomStub(id).initialize()).toBe('created');
    const first = await inRoom(id, (_room, storage) => createdAt(storage));
    await new Promise((r) => setTimeout(r, 5));
    expect(await roomStub(id).initialize()).toBe('exists');
    expect(await inRoom(id, (_room, storage) => createdAt(storage))).toBe(first);
  });
});

describe('GET /api/boards/:id (share.open_link, share.not_found)', () => {
  it('TC-06: a valid but never-created id → 404 and no storage written', async () => {
    const id = newBoardId();
    const response = await getBoard(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(await inRoom(id, (_room, storage) => tables(storage))).toEqual([]);
  });

  it('TC-07: malformed ids → 404 each, and no room is ever reached', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const get = vi.spyOn(env.BOARD_ROOM, 'get');
    const valid = newBoardId();
    for (const bad of ['abc', valid.slice(1), `${valid}x`, `${valid.slice(0, 10)}/${valid.slice(11)}`]) {
      const response = await getBoard(bad);
      expect(response.status, bad).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-08: a legacy board (saved updates, no created_at) exists → 200', async () => {
    const id = newBoardId();
    const [row] = retroBoard(1).rows;
    await inRoom(id, (_room, storage) => {
      new BoardStore(storage).migrate();
      storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', row!.data.slice().buffer, row!.data.byteLength);
      expect(createdAt(storage)).toBeUndefined();
    });
    const response = await getBoard(id);
    expect(response.status).toBe(200);
  });

  it('a legacy board with tables but no content does not count as existing', async () => {
    const id = newBoardId();
    await inRoom(id, (_room, storage) => new BoardStore(storage).migrate());
    expect((await getBoard(id)).status).toBe(404);
  });
});

describe('WebSocket /api/rooms/:id (share.not_found)', () => {
  it('TC-09: upgrade to an unknown id → 404, no socket accepted, no tables created', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
    const after = await runInDurableObject(roomStub(id), (_room, state) => ({
      tables: tables(state.storage),
      sockets: state.getWebSockets().length,
    }));
    expect(after).toEqual({ tables: [], sockets: 0 });
  });

  it('TC-10: upgrade after POST → 101 and story 3 sync works', async () => {
    const id = await createBoardId();
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close(1000, 'done');
    const a = await TestClient.join(id);
    const b = await TestClient.join(id);
    clients.push(a, b);
    createSticky(a.doc, { x: 1, y: 2 });
    await waitForConvergence([a, b]);
    expect(b.snapshot()).toHaveLength(1);
  });
});

describe('privacy (share constraints)', () => {
  it('TC-32: the served index.html sets <meta name="referrer" content="no-referrer">', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Accept: 'text/html' } });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<meta name="referrer" content="no-referrer" />');
    }
  });
});
