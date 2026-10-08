/**
 * Board API integration tests (story 5, TC-05..TC-10, TC-12, TC-14, TC-15,
 * TC-32): the POST /api/boards + GET /api/boards/:id contract, 404
 * no-leak/no-write semantics, the initialize() RPC, and the no-referrer
 * header in served HTML.
 *
 * Runs against the real Worker in workerd (vitest pool workers): SELF.fetch
 * hits the actual fetch handler; runInDurableObject inspects real storage.
 * TC-07 and TC-12 additionally call the exported handler directly with a
 * spy/fake env to prove "no RPC is made" / "500 on RPC failure".
 */

import { describe, expect, it, vi } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/index';
import { BoardRoom } from '../../src/worker/board-room';
import { createBoard } from '../../src/worker/create-board';
import { WsClient } from './fixtures/ws-client';

/** All table names in the board's Durable Object storage. */
async function tableNames(boardId: string): Promise<string[]> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject<BoardRoom, string[]>(stub, (_i, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => String(row.name)),
  );
}

async function createdAtOf(boardId: string): Promise<string | null> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject<BoardRoom, string | null>(stub, (_i, state) => {
    const sql = state.storage.sql;
    // The table may not exist at all (an unknown board stored nothing).
    const tables = new Set(
      sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => String(r.name)),
    );
    if (!tables.has('storage_meta')) {
      return null;
    }
    const rows = sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray();
    return rows.length > 0 ? String(rows[0].value) : null;
  });
}

describe('board creation + existence API (share.board_api)', () => {
  it('TC-05: POST /api/boards → 201 with a fresh valid id; GET then 200; created_at recorded', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`http://localhost/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: body.id });

    const createdAt = await createdAtOf(body.id);
    expect(createdAt).not.toBeNull();
    expect(Number(createdAt)).toBeGreaterThan(0);
  });

  it('TC-06: GET unknown id → 404 not_found and NO tables are created', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });

    const tables = await tableNames(id);
    expect(tables).not.toContain('storage_meta');
    expect(tables).not.toContain('updates');
    expect(tables).not.toContain('snapshot_chunks');
    expect(await createdAtOf(id)).toBeNull();
  });

  it('TC-07: malformed id → 404 with no RPC (no namespace get for the bad id)', async () => {
    // Through the real Worker.
    for (const bad of ['abc', 'a'.repeat(23), '../x', 'with space']) {
      const res = await SELF.fetch(`http://localhost/api/boards/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }

    // Directly against the exported handler with a spy namespace: a
    // malformed id must not touch the namespace at all (design: "no RPC").
    let touches = 0;
    const spyEnv = {
      BOARD_ROOM: {
        get: (): unknown => {
          touches += 1;
          return {};
        },
        idFromName: (name: string): string => name,
      },
      ASSETS: { fetch: async (): Promise<Response> => new Response('not used') },
    } as unknown as Env;
    const res = await worker.fetch(new Request('http://localhost/api/boards/abc'), spyEnv);
    expect(res.status).toBe(404);
    expect(touches).toBe(0);
  });

  it('TC-08: legacy board (updates rows, no created_at) → GET 200', async () => {
    const id = newBoardId();
    // Seed exactly the story-4 shape: tables + log rows, no created_at.
    await runInDurableObject<BoardRoom, void>(
      env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)),
      (instance) => {
        instance.store.migrate();
        const doc = new Y.Doc();
        createSticky(doc, { x: 0, y: 0 });
        instance.store.append(Y.encodeStateAsUpdate(doc));
      },
    );

    const res = await SELF.fetch(`http://localhost/api/boards/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });
    // …and it must have left the legacy shape alone (no created_at added).
    expect(await createdAtOf(id)).toBeNull();
  });

  it('TC-09: WebSocket upgrade for an unknown board → 404 and no storage', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();

    const tables = await tableNames(id);
    expect(tables).not.toContain('updates');
    expect(tables).not.toContain('snapshot_chunks');
    expect(await createdAtOf(id)).toBeNull();
  });

  it('TC-10: after POST, upgrade succeeds (101) and a second client syncs the board', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    const { id } = (await res.json()) as { id: string };

    const upgrade = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(upgrade.status).toBe(101);

    const a = await WsClient.connect(id);
    await a.waitForSync();
    const b = await WsClient.connect(id);
    await b.waitForSync();
    a.addNote('hello sync');
    await b.waitForObjects((o) => o.some((n) => n.text === 'hello sync'));
    a.close();
    b.close();
  });

  it('TC-14: other methods on the API → 405', async () => {
    for (const method of ['PUT', 'DELETE', 'GET']) {
      const res = await SELF.fetch('http://localhost/api/boards', { method });
      expect(res.status).toBe(405);
    }
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${id}`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

describe('initialize() RPC (share.board_api)', () => {
  it('TC-15: initialize() twice → "created" then "exists"; created_at unchanged', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    const first = await runInDurableObject<BoardRoom, 'created' | 'exists'>(stub, (instance) =>
      instance.initialize(),
    );
    expect(first).toBe('created');
    const createdAtFirst = await createdAtOf(id);
    expect(createdAtFirst).not.toBeNull();

    // Let time pass so a rewrite would be observable.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runInDurableObject<BoardRoom, 'created' | 'exists'>(stub, (instance) =>
      instance.initialize(),
    );
    expect(second).toBe('exists');
    expect(await createdAtOf(id)).toBe(createdAtFirst);
  });

  it('TC-12: initialize() throwing → POST 500 create_failed; fresh-id collision → 500', async () => {
    // RPC failure.
    const throwingEnv = {
      BOARD_ROOM: {
        get: () => ({
          initialize: async (): Promise<'created' | 'exists'> => {
            throw new Error('injected RPC failure');
          },
        }),
        idFromName: (name: string): string => name,
      },
      ASSETS: { fetch: async (): Promise<Response> => new Response('not used') },
    } as unknown as Env;
    const res = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      throwingEnv,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'create_failed' });

    // And through the exported createBoard() directly.
    const result = await createBoard(throwingEnv);
    expect(result).toEqual({ ok: false, reason: 'create_failed' });

    // Collision on a FRESH id (initialize reports an existing board): fail,
    // never retry with a new id, never return someone else's board.
    const collidingEnv = {
      BOARD_ROOM: {
        get: () => ({ initialize: async (): Promise<'created' | 'exists'> => 'exists' as const }),
        idFromName: (name: string): string => name,
      },
      ASSETS: { fetch: async (): Promise<Response> => new Response('not used') },
    } as unknown as Env;
    const res2 = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      collidingEnv,
    );
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: 'create_failed' });

    // The happy path returns a fresh id.
    const happyEnv = {
      BOARD_ROOM: {
        get: () => ({ initialize: async (): Promise<'created' | 'exists'> => 'created' as const }),
        idFromName: (name: string): string => name,
      },
      ASSETS: { fetch: async (): Promise<Response> => new Response('not used') },
    } as unknown as Env;
    const res3 = await worker.fetch(
      new Request('http://localhost/api/boards', { method: 'POST' }),
      happyEnv,
    );
    expect(res3.status).toBe(201);
    const body3 = (await res3.json()) as { id: string };
    expect(body3.id).toMatch(BOARD_ID_PATTERN);
    vi.clearAllMocks();
  });
});

describe('served HTML (share.privacy)', () => {
  it('TC-32: index.html served by the Worker carries a no-referrer meta tag', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');

    // The SPA fallback serves the same document for board links.
    const id = newBoardId();
    const res2 = await SELF.fetch(`http://localhost/b/${id}`);
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain('<meta name="referrer" content="no-referrer"');
  });
});
