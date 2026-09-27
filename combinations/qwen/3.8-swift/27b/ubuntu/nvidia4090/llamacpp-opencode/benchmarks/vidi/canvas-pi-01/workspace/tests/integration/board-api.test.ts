// Board creation & lookup API (spec: share.board_api, TC-05 to TC-15, TC-32).
//
// These drive the real `fetch` handler from `src/worker/index.ts` against the
// REAL pool env (real BoardRoom DOs, real rate limiter), so end-to-end
// behaviour is tested. Determinism notes:
//  - every visitor key (CF-Connecting-IP) is unique per test, so the 60s
//    rate-limit window can never leak between tests;
//  - TC-07/TC-12 use a mock env to observe namespace calls / inject a
//    failing initialize (the design's "inject failing initialize" boundary);
//  - legacy boards are seeded in-storage via the room's test hook
//    (equivalent to the /__test route, which e2e TC-31 exercises).

import { afterAll, describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { createBoard } from '../../src/worker/create-board';
import worker, { type Env } from '../../src/worker';
import { createSticky } from '../../src/shared/board-model';
import { connectRoom, waitFor, type RoomClient } from './helpers/ws-client';

const clients: RoomClient[] = [];
function track(client: RoomClient): RoomClient {
  clients.push(client);
  return client;
}
afterAll(() => {
  for (const client of clients.splice(0)) client.close();
});

/** The visitor's IP is the rate-limit key: one bucket per test. */
function postBoard(ip: string): Promise<Response> {
  return worker.fetch(
    new Request('http://localhost/api/boards', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    }),
    env,
  );
}

function checkBoard(id: string, ip: string): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost/api/boards/${id}`, {
      headers: { 'CF-Connecting-IP': ip },
    }),
    env,
  );
}

function upgradeRequest(boardId: string): Request {
  return new Request(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  });
}

function roomStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** created_at (epoch ms string) from a board's storage, or null. */
async function createdAt(boardId: string): Promise<string | null> {
  return runInDurableObject(roomStub(boardId), (room) => {
    try {
      const rows = room.ctx.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'created_at')
        .toArray();
      return rows.length > 0 ? (rows[0]!.value as string) : null;
    } catch {
      return null; // no schema: the board was never created
    }
  });
}

/** Table names in a board's storage (empty when nothing was written). */
async function tableNames(boardId: string): Promise<string[]> {
  return runInDurableObject(roomStub(boardId), (room) => {
    const rows = room.ctx.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray();
    return rows.map((r) => r.name as string);
  });
}

// TC-32 serves the built client through ASSETS; the standard flows (npm run
// e2e, CI) build first. If dist/ is missing the assets fetch 404s and the
// test fails loudly, which is the right signal.
describe('board creation & lookup API (share.board_api)', () => {
  it('TC-05: POST /api/boards → 201 + valid id; board exists for lookup and is recorded', async () => {
    const res = await postBoard('10.0.5.1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const check = await checkBoard(body.id, '10.0.5.2');
    expect(check.status).toBe(200);
    expect((await check.json()) as { id: string }).toEqual({ id: body.id });

    // created_at was recorded by initialize() (share.board_api).
    const created = await createdAt(body.id);
    expect(created).not.toBeNull();
    expect(Number(created)).toBeGreaterThan(0);
  });

  it('TC-06: GET /api/boards/:id for an unknown id → 404 and nothing is written', async () => {
    const id = newBoardId();
    const res = await checkBoard(id, '10.0.6.1');
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    // Probing must not create storage (the room's constructor is read-only).
    expect(await tableNames(id)).toEqual([]);
    expect(await createdAt(id)).toBeNull();
  });

  it('TC-07: malformed ids → 404 and the DO namespace is never touched', async () => {
    // Mock env: observe idFromName/get calls (worker.test.ts's pattern).
    const idFromNameCalls: string[] = [];
    const getCalls: string[] = [];
    const mockEnv = {
      BOARD_ROOM: {
        idFromName: (boardId: string) => {
          idFromNameCalls.push(boardId);
          return boardId;
        },
        get: (id: string) => {
          getCalls.push(id);
          return {
            exists: () => Promise.resolve(true),
            initialize: () => Promise.resolve('created' as const),
          };
        },
      },
      ASSETS: { fetch: () => Promise.resolve(new Response('no', { status: 404 })) },
      BOARD_CREATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      },
    } as unknown as Env;

    const malformed = [
      'abc',
      'a'.repeat(23), // too long
      'a'.repeat(21), // too short
      'has space',
      'with/slash',
      '%2Bnotid', // decodes to '+notid': not in the alphabet
    ];
    for (const id of malformed) {
      const res = await worker.fetch(new Request(`http://localhost/api/rooms/${encodeURIComponent(id)}`), mockEnv);
      expect(res.status, `rooms/${id}`).toBe(404);
      const check = await worker.fetch(new Request(`http://localhost/api/boards/${encodeURIComponent(id)}`), mockEnv);
      expect(check.status, `boards/${id}`).toBe(404);
    }
    expect(idFromNameCalls).toEqual([]);
    expect(getCalls).toEqual([]);
  });

  it('TC-08: a legacy board (updates, no created_at) is treated as existing', async () => {
    const id = newBoardId();
    const seeded = await runInDurableObject(roomStub(id), (room) => room.seedLegacyForTests(3));
    expect(seeded).toBe(3);
    expect(await createdAt(id)).toBeNull(); // legacy: no created_at

    const res = await checkBoard(id, '10.0.8.1');
    expect(res.status).toBe(200);
  });

  it('TC-09: WS upgrade to an unknown board → 404 and nothing is written', async () => {
    const id = newBoardId();
    const res = await worker.fetch(upgradeRequest(id), env);
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();

    expect(await tableNames(id)).toEqual([]);
    expect(await createdAt(id)).toBeNull();
  });

  it('TC-10: after creation the upgrade succeeds and story 3 sync works', async () => {
    const res = await postBoard('10.0.10.1');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const up = await worker.fetch(upgradeRequest(id), env);
    expect(up.status).toBe(101);
    expect(up.webSocket).toBeDefined();
    await up.body?.cancel(); // abort this extra connection; the helper opens its own

    const a = track(await connectRoom(id, { user: 'a' }));
    const b = track(await connectRoom(id, { user: 'b' }));
    await new Promise((r) => setTimeout(r, 100)); // let the handshake settle

    createSticky(a.doc, { x: 5, y: 6 });
    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the created note');
    // (x/y are stored relative to the sticky's top-left corner; compare the
    // full converged state instead of raw coordinates.)
    expect(b.boardState()).toEqual(a.boardState());
  });

  it('TC-11: a colliding id is retried with a fresh id (injected generator)', async () => {
    // Pre-create the first candidate so its initialize() returns 'exists'.
    const existing = newBoardId();
    const fresh = newBoardId();
    expect(existing).not.toBe(fresh);
    const init = await runInDurableObject(roomStub(existing), (room) => room.initialize());
    expect(init).toBe('created');

    const ids = [existing, fresh];
    let i = 0;
    const result = await createBoard(env, '10.0.11.2', () => ids[i++]!);
    expect(result).toEqual({ ok: true, id: fresh });

    // Both boards exist independently.
    expect((await checkBoard(existing, '10.0.11.3')).status).toBe(200);
    expect((await checkBoard(fresh, '10.0.11.4')).status).toBe(200);
  });

  it('TC-12: a failing initialize → 500 create_failed', async () => {
    const mockEnv = {
      BOARD_ROOM: {
        idFromName: (boardId: string) => boardId,
        get: () => ({
          initialize: () => Promise.reject(new Error('storage exploded')),
        }),
      },
      ASSETS: { fetch: () => Promise.resolve(new Response('no', { status: 404 })) },
      BOARD_CREATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    } as unknown as Env;

    const res = await worker.fetch(new Request('http://localhost/api/boards', { method: 'POST' }), mockEnv);
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });
  });

  it('TC-13: the 11th creation from one visitor → 429; a different visitor is unaffected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await postBoard('10.0.13.1');
      statuses.push(res.status);
      await res.body?.cancel();
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses[10]).toBe(429);
    expect((await (await postBoard('10.0.13.1')).json()) as { error: string }).toEqual({
      error: 'rate_limited',
    });

    // A different visitor has its own bucket.
    const other = await postBoard('10.0.13.2');
    expect(other.status).toBe(201);
  });

  it('TC-14: PUT /api/boards → 405', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'PUT' }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize() is idempotent — created once, created_at set once', async () => {
    const id = newBoardId();
    const stub = roomStub(id);
    const first = await runInDurableObject(stub, (room) => room.initialize());
    expect(first).toBe('created');
    const createdOnce = await createdAt(id);
    expect(createdOnce).not.toBeNull();

    const second = await runInDurableObject(stub, (room) => room.initialize());
    expect(second).toBe('exists');
    expect(await createdAt(id)).toBe(createdOnce); // unchanged

    // exists() agrees.
    expect(await runInDurableObject(stub, (room) => room.exists())).toBe(true);
  });

  it('TC-32: the SPA is served at / and /b/:id', async () => {
    for (const path of ['/', `/b/${newBoardId()}`]) {
      const res = await worker.fetch(new Request(`http://localhost${path}`), env);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<div id="root">');
    }
  });
});
