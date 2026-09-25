/**
 * Board creation and existence API (share.board_api, TC-05 to TC-15, TC-32) against the real
 * Worker, real BoardRoom RPC and real SQLite storage.
 *
 * Rate limiter: the pinned local runtime (Miniflare via @cloudflare/vitest-pool-workers)
 * implements the `ratelimits` binding, so TC-13 uses the real BOARD_CREATE_LIMITER binding
 * from wrangler.jsonc. Every test uses its own random CF-Connecting-IP so the limiter's
 * per-visitor counts never leak between tests.
 */
import { SELF, env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import worker from '../../src/worker/index';
import { handleBoardsRequest } from '../../src/worker/create-board';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import { buildRetroBoard } from '../fixtures/boards';
import { TestClient, roomUrl, waitConverged } from './helpers/ws-client';

const ORIGIN = 'http://vidi6.test';
const MALFORMED_IDS = ['abc', 'AbCdEfGhIjKlMnOpQr_-0', 'AbCdEfGhIjKlMnOpQr_-091', 'AbCdEfGhIjK/MnOpQr_-09'];

let open: TestClient[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
  vi.restoreAllMocks();
});

function randomIp(): string {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  return `10.${a}.${b}.${c}`;
}

function room(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function postBoard(ip = randomIp()): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
}

async function createViaApi(ip = randomIp()): Promise<string> {
  const res = await postBoard(ip);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Tables in the object's SQLite database, without the platform's internal `_cf_*` tables. */
async function tables(boardId: string): Promise<string[]> {
  return runInDurableObject(room(boardId), (_i, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((r) => r.name)
      .filter((n) => !n.startsWith('_cf_') && !n.startsWith('sqlite_')),
  );
}

async function createdAt(boardId: string): Promise<number | null> {
  return runInDurableObject(room(boardId), (_i, state) => new BoardStore(state.storage).createdAt());
}

describe('POST /api/boards and GET /api/boards/:id (share.board_api)', () => {
  it('TC-05 creates a board: 201 with a valid id, GET 200, created_at set', async () => {
    const before = Date.now();
    const res = await postBoard();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);
    const get = await SELF.fetch(`${ORIGIN}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: body.id });
    const at = await createdAt(body.id);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before - 1000);
  });

  it('TC-06 an unknown valid id is 404 and leaves no storage behind', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${ORIGIN}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07 malformed ids are 404 without any Durable Object call', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const get = vi.spyOn(env.BOARD_ROOM, 'get');
    for (const bad of MALFORMED_IDS) {
      const res = await worker.fetch(new Request(`${ORIGIN}/api/boards/${bad}`), env);
      expect(res.status, bad).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-08 a legacy board (saved content, no created_at) exists', async () => {
    const id = newBoardId();
    const doc = new Y.Doc();
    buildRetroBoard(doc);
    await runInDurableObject(room(id), (_i, state) => {
      const store = new BoardStore(state.storage);
      store.append(Y.encodeStateAsUpdate(doc)); // migrates lazily, as story 4 rooms did
    });
    expect(await createdAt(id)).toBeNull();
    const res = await SELF.fetch(`${ORIGIN}/api/boards/${id}`);
    expect(res.status).toBe(200);
  });

  it('TC-14 other methods on /api/boards are 405', async () => {
    const put = await SELF.fetch(`${ORIGIN}/api/boards`, { method: 'PUT' });
    expect(put.status).toBe(405);
    const get = await SELF.fetch(`${ORIGIN}/api/boards`);
    expect(get.status).toBe(405);
    const del = await SELF.fetch(`${ORIGIN}/api/boards/${newBoardId()}`, { method: 'DELETE' });
    expect(del.status).toBe(405);
  });
});

describe('Board rooms require an existing board (share.board_api)', () => {
  it('TC-09 a WebSocket upgrade to an unknown board is 404: no socket, no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(roomUrl(id), { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
    expect(await tables(id)).toEqual([]);
    const sockets = await runInDurableObject(room(id), (_i, state) => state.getWebSockets().length);
    expect(sockets).toBe(0);
  });

  it('TC-10 after POST the room upgrades (101) and live sync works', async () => {
    const id = await createViaApi();
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    open.push(a, b);
    await a.waitForSync();
    await b.waitForSync();
    const note = createSticky(a.doc, { x: 1, y: 2 });
    await waitConverged([a, b]);
    expect(b.snapshot().map((n) => n.id)).toEqual([note]);
  });

  it('a legacy board still accepts sockets and serves its content', async () => {
    const id = newBoardId();
    const doc = new Y.Doc();
    const notes = buildRetroBoard(doc);
    await runInDurableObject(room(id), (_i, state) => new BoardStore(state.storage).append(Y.encodeStateAsUpdate(doc)));
    await evictDurableObject(room(id)); // the room loaded before the seed was written
    const c = await TestClient.connect(id);
    open.push(c);
    await c.waitForSync();
    expect(c.snapshot()).toHaveLength(notes.length);
  });
});

describe('Creation edge cases (share.unique, share.create_failure, share.rate_limit)', () => {
  it('TC-11 an id that already belongs to a board is skipped; the existing board is untouched', async () => {
    const existing = await createViaApi();
    const before = await createdAt(existing);
    const fresh = newBoardId();
    const ids = [existing, fresh];
    const req = new Request(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': randomIp() } });
    const res = await handleBoardsRequest(req, env, { generate: () => ids.shift() ?? newBoardId() });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: fresh });
    expect(await createdAt(existing)).toBe(before);
    expect(await createdAt(fresh)).not.toBeNull();
  });

  it('TC-12 an initialize failure is 500 create_failed', async () => {
    const req = new Request(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': randomIp() } });
    const res = await handleBoardsRequest(req, env, {
      initialize: async () => {
        throw new Error('injected: RPC failure');
      },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
  });

  it(`TC-13 BOARD_CREATE_LIMIT (${BOARD_CREATE_LIMIT}) creations per visitor, then 429; another visitor is unaffected`, async () => {
    const ip = randomIp();
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) expect((await postBoard(ip)).status, `creation ${i + 1}`).toBe(201);
    const limited = await postBoard(ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect((await postBoard(randomIp())).status).toBe(201);
  });

  it('TC-15 initialize() twice: created then exists, created_at unchanged', async () => {
    const id = newBoardId();
    expect(await room(id).initialize()).toBe('created');
    const first = await createdAt(id);
    expect(first).not.toBeNull();
    expect(await room(id).initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(first);
    expect(await room(id).exists()).toBe(true);
  });
});

describe('Privacy (PRD share constraints)', () => {
  it('TC-32 the served page never sends board links as a Referer', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const html = await (await SELF.fetch(`${ORIGIN}${path}`)).text();
      expect(html).toContain('<meta name="referrer" content="no-referrer"');
    }
  });
});
