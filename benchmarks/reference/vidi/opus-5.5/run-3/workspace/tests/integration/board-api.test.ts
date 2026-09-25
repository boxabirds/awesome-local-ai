// share.board_api against the real Worker, real Durable Object RPC and real SQLite storage.
//
// Rate limiting (TC-13) uses the real `ratelimits` binding from wrangler.jsonc: the pinned local runtime
// (miniflare) simulates it with fixed windows aligned to the wall clock, so the test starts well inside a window.
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { handleRequest, type Env } from '../../src/worker/index';
import { BoardStore } from '../../src/worker/board-store';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { TestClient, converged, openSocket, sleep } from './ws-client';

const BASE = 'http://vidi6.test';

/** A distinct visitor per call, so tests never share a rate-limit bucket. */
function visitor(): string {
  return `203.0.113.${Math.floor(Math.random() * 250) + 1}-${crypto.randomUUID()}`;
}

function post(ip: string = visitor()): Promise<Response> {
  return SELF.fetch(`${BASE}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
}

async function createViaApi(): Promise<string> {
  const res = await post();
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const stub = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

/** Board tables in the object's SQLite database (the platform's own `_cf_*` tables excluded). */
function userTables(id: string): Promise<string[]> {
  return runInDurableObject(stub(id), (_room, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((r) => String(r.name))
      .filter((n) => !n.startsWith('_cf_') && n !== 'sqlite_sequence'),
  );
}

function createdAt(id: string): Promise<number | null> {
  return runInDurableObject(stub(id), (_room, state) => new BoardStore(state.storage).createdAt());
}

/** An env whose namespace records every use (to prove malformed ids never reach a Durable Object). */
function spiedEnv() {
  const idFromName = vi.fn(env.BOARD_ROOM.idFromName.bind(env.BOARD_ROOM));
  const get = vi.fn(env.BOARD_ROOM.get.bind(env.BOARD_ROOM));
  const spied = { ...env, BOARD_ROOM: { ...env.BOARD_ROOM, idFromName, get } } as unknown as Env;
  return { spied, idFromName, get };
}

describe('share.board_api: create and check', () => {
  it('TC-05 POST creates a board: 201 with a valid id, GET finds it, created_at is set', async () => {
    const before = Date.now();
    const res = await post();
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id });
    const at = await createdAt(id);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before - 1000);
  });

  it('TC-06 GET of a never-created id is 404 and writes no storage', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await userTables(id)).toEqual([]);
  });

  it('TC-07 malformed ids are 404 and never reach a Durable Object', async () => {
    const { spied, idFromName, get } = spiedEnv();
    const malformed = ['abc', 'A'.repeat(21), 'A'.repeat(23), 'AbCdEfGhIjKl%2FnOpQr_-0', 'bad!idbad!idbad!idbad!'];
    for (const bad of malformed) {
      const res = await handleRequest(new Request(`${BASE}/api/boards/${bad}`), spied);
      expect(res.status, bad).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    // And through the real entry point.
    expect((await SELF.fetch(`${BASE}/api/boards/abc`)).status).toBe(404);
  });

  it('TC-08 a legacy board (saved content, no created_at) exists', async () => {
    const id = newBoardId();
    const { updates } = retroBoard();
    await runInDurableObject(stub(id), (_room, state) => {
      const store = new BoardStore(state.storage);
      for (const u of updates) store.append(u);
    });
    expect(await createdAt(id)).toBeNull();
    const res = await SELF.fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(200);
  });

  it('TC-14 other methods on /api/boards are 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      const res = await SELF.fetch(`${BASE}/api/boards`, { method });
      expect(res.status, method).toBe(405);
    }
  });
});

describe('share.board_api: WebSocket', () => {
  it('TC-09 upgrading to a never-created board is 404: no socket, no tables', async () => {
    const id = newBoardId();
    const { status, ws } = await openSocket(id);
    expect(status).toBe(404);
    expect(ws).toBeNull();
    expect(await userTables(id)).toEqual([]);
  });

  it('TC-10 upgrading to a created board is 101 and live sync works', async () => {
    const id = await createViaApi();
    const { status, ws } = await openSocket(id);
    expect(status).toBe(101);
    ws?.close();
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    createSticky(a.doc, { x: 5, y: 5 });
    const notes = await converged([a, b]);
    expect(notes).toHaveLength(1);
    a.close();
    b.close();
  });
});

describe('share.board_api: collisions and failures', () => {
  it('TC-11 an id that is already a board is skipped; the next fresh id is created', async () => {
    const existing = await createViaApi();
    const existingCreatedAt = await createdAt(existing);
    const fresh = newBoardId();
    const ids = [existing, fresh];
    const generateId = vi.fn(() => ids.shift()!);
    const res = await handleRequest(
      new Request(`${BASE}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': visitor() } }),
      env,
      { generateId },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: fresh });
    expect(generateId).toHaveBeenCalledTimes(2);
    expect(await createdAt(existing)).toBe(existingCreatedAt);
    expect(await createdAt(fresh)).not.toBeNull();
  });

  it('TC-12 initialize throwing gives 500 create_failed', async () => {
    const initialize = vi.fn(async () => {
      throw new Error('boom');
    });
    const failing = {
      ...env,
      BOARD_ROOM: { idFromName: (n: string) => n, get: () => ({ initialize }) },
    } as unknown as Env;
    const res = await handleRequest(
      new Request(`${BASE}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': visitor() } }),
      failing,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });
    expect(initialize).toHaveBeenCalled();
  });

  it('TC-15 initialize twice: created, then exists; created_at unchanged', async () => {
    const id = newBoardId();
    expect(await stub(id).initialize()).toBe('created');
    const first = await createdAt(id);
    await sleep(5);
    expect(await stub(id).initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(first);
  });

  it('a legacy board is never handed out as new', async () => {
    const id = newBoardId();
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    createSticky(doc, { x: 0, y: 0 });
    await runInDurableObject(stub(id), (_room, state) => {
      const store = new BoardStore(state.storage);
      for (const u of updates) store.append(u);
    });
    expect(await stub(id).initialize()).toBe('exists');
    expect(await createdAt(id)).toBeNull();
  });
});

describe('share.rate_limit', () => {
  it(
    'TC-13 BOARD_CREATE_LIMIT creations per visitor per period; the next is 429; other visitors are unaffected',
    async () => {
      // Fixed windows: start with at least 15 s of the current one left.
      const period = BOARD_CREATE_PERIOD_SECONDS * 1000;
      const into = Date.now() % period;
      if (period - into < 15_000) await sleep(period - into + 250);

      const ip = visitor();
      for (let i = 0; i < BOARD_CREATE_LIMIT; i++) expect((await post(ip)).status, `creation ${i + 1}`).toBe(201);
      const limited = await post(ip);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: 'rate_limited' });
      expect((await post(visitor())).status).toBe(201);
    },
    40_000,
  );
});

describe('share privacy', () => {
  it('TC-32 the served page tells browsers not to send board links as a Referer', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(await res.text()).toContain('<meta name="referrer" content="no-referrer" />');
    }
  });
});
