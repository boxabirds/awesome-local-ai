// Story 5, task 6: board API integration tests (workerd pool).
//
// TC-05  POST /api/boards -> 201 { id }; GET that id -> 200; created_at set.
// TC-06  GET an unknown id -> 404 and sqlite_master shows no tables.
// TC-07  malformed ids -> 404 each, without allocating a Durable Object.
// TC-08  a legacy board (updates rows, no created_at) answers 200.
// TC-09  WS upgrade to an unknown board -> 404, no socket, no tables.
// TC-10  after POST, the room upgrades and story 3 sync works.
// TC-11  an id collision is retried; the existing board is untouched.
// TC-12  initialize failure / exhausted collisions -> 500 create_failed.
// TC-13  creation is rate limited per visitor IP (real ratelimits binding).
// TC-14  PUT /api/boards -> 405.
// TC-15  initialize() twice: created then exists; created_at unchanged.
// TC-32  the served index.html carries <meta name="referrer"
//        content="no-referrer"> (a board page must never leak the board
//        link as a Referer to external origins).

import { describe, expect, it, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';
import { createStickyAt } from '../../src/shared/board-model';
import { MemoryLimiter, createBoard } from '../../src/worker/create-board';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/board-room';
import { room } from './persist-helpers';
import { WsClient } from './ws-client';

/** POST /api/boards from a given visitor IP (workerd sets no req.cf). */
async function postAs(ip: string): Promise<Response> {
  return SELF.fetch('http://localhost/api/boards', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  });
}

describe('board API (story 5, share.board_api)', () => {
  it('TC-05: POST /api/boards creates a board; GET 200; created_at set', async () => {
    const res = await postAs('10.5.0.5');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`http://localhost/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect((await get.json()) as unknown).toEqual({ id: body.id });

    const inspect = await room(body.id).testInspectStorage();
    expect(Number(inspect.meta['created_at'])).toBeGreaterThan(0);
  });

  it('TC-06: GET an unknown id is 404 and creates no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ error: 'not_found' });
    // Probing an unknown link must not create storage (share.board_api).
    expect(await room(id).testTableNames()).toEqual([]);
  });

  it('TC-07: malformed ids are 404 without allocating a Durable Object', async () => {
    const idFromName = vi
      .spyOn(env.BOARD_ROOM, 'idFromName')
      .mockImplementation(() => {
        throw new Error('idFromName must not be called for malformed ids');
      });
    try {
      for (const bad of ['abc', 'a'.repeat(23), 'x'.repeat(21) + '/']) {
        const res = await SELF.fetch(`http://localhost/api/boards/${bad}`);
        expect(res.status, `id ${JSON.stringify(bad)}`).toBe(404);
      }
      expect(idFromName).not.toHaveBeenCalled();
    } finally {
      idFromName.mockRestore();
    }
  });

  it('TC-08: a legacy board (updates rows, no created_at) answers 200', async () => {
    const id = newBoardId();
    // Story 4 data: an updates row exists but no storage_meta/created_at.
    const seeded = await room(id).testSeedLegacyNotes(5);
    expect(seeded).toBe(5);
    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(200);
  });

  it('TC-09: WS upgrade to an unknown board is 404, no socket, no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(404);
    expect((res as unknown as { webSocket?: WebSocket | null }).webSocket ?? null).toBeNull();
    expect(await room(id).testTableNames()).toEqual([]);
  });

  it('TC-10: after POST the room upgrades and story 3 sync works', async () => {
    const created = await postAs('10.5.0.10');
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const client = await WsClient.connect(id);
    try {
      await client.waitForSync();
      const noteId = client.applyLocal((doc) => createStickyAt(doc, 1, 2, 'green'));
      await client.waitUntil(() => client.hasNote(noteId), 3000);
    } finally {
      await client.destroy();
    }
  });

  it('TC-11: an id collision is retried; the existing board is untouched', async () => {
    const first = await createBoard(env, '10.5.0.11a');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const takenId = first.id;
    const takenBefore = Number(
      (await room(takenId).testInspectStorage()).meta['created_at'],
    );

    // Injected deterministic generator: the taken id first, then a fresh one.
    const fresh = newBoardId();
    let draw = 0;
    const second = await createBoard(env, '10.5.0.11b', {
      generate: () => (draw++ === 0 ? takenId : fresh),
    });
    expect(second).toEqual({ ok: true, id: fresh });

    // The existing board was never re-initialised (share.unique).
    const takenAfter = Number(
      (await room(takenId).testInspectStorage()).meta['created_at'],
    );
    expect(takenAfter).toBe(takenBefore);
  });

  it('TC-12: a throwing initialize maps to 500 create_failed (HTTP)', async () => {
    const throwing = {
      idFromName: (name: string) => name,
      get: () => ({
        initialize: async () => {
          throw new Error('injected RPC failure');
        },
      }),
    };
    const fakeEnv = {
      ...env,
      BOARD_ROOM: throwing,
      BOARD_CREATE_LIMITER: new MemoryLimiter(10),
    } as unknown as Env;
    const res = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      fakeEnv,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toEqual({ error: 'create_failed' });
  });

  it('TC-12: exhausted collisions map to 500 create_failed (HTTP)', async () => {
    const alwaysExists = {
      idFromName: (name: string) => name,
      get: () => ({ initialize: async (): Promise<'exists'> => 'exists' }),
    };
    const fakeEnv = {
      ...env,
      BOARD_ROOM: alwaysExists,
      BOARD_CREATE_LIMITER: new MemoryLimiter(10),
    } as unknown as Env;
    const res = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      fakeEnv,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toEqual({ error: 'create_failed' });
  });

  it('TC-13: creation is rate limited per visitor IP', async () => {
    const ip = '10.5.0.13';
    for (let i = 0; i < BOARD_CREATE_LIMIT; i += 1) {
      const res = await postAs(ip);
      expect(res.status, `attempt ${i + 1} of ${BOARD_CREATE_LIMIT}`).toBe(201);
    }
    const blocked = await postAs(ip);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()) as unknown).toEqual({ error: 'rate_limited' });
    // A different visitor is unaffected (share.rate_limit).
    const other = await postAs('10.5.0.130');
    expect(other.status).toBe(201);
  });

  it('TC-14: PUT /api/boards is 405', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
    expect((await res.json()) as unknown).toEqual({ error: 'method_not_allowed' });
  });

  it('TC-15: initialize() twice: created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const stub = room(id);
    expect(await stub.initialize()).toBe('created');
    const before = (await stub.testInspectStorage()).meta['created_at'];
    expect(Number(before)).toBeGreaterThan(0);
    expect(await stub.initialize()).toBe('exists');
    const after = (await stub.testInspectStorage()).meta['created_at'];
    expect(after).toBe(before);
  });

  it('TC-32: the served index.html pins referrer no-referrer', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
