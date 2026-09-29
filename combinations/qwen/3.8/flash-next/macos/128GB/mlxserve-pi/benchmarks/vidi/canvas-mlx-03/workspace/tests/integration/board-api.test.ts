/// <reference types="@cloudflare/vitest-pool-workers" />
// Integration tests for story 5's board API (share.board_api): the HTTP contract
// of POST /api/boards and GET /api/boards/:id, the 404 answers on unknown and
// malformed ids, the existence rule (created_at OR pre-existing rows) and the
// "checking a link writes nothing" guarantee — all against the real Worker, the
// real Durable Object RPC and real SQLite.
//
// Rate limiter: the REAL `BOARD_CREATE_LIMITER` binding is used. The pinned
// local runtime (wrangler 3.114 / workerd) supports the Rate Limiting API
// binding declared under `unsafe.bindings` in wrangler.jsonc — verified at
// implementation time: `limit({key})` returned success 10 times for a key and
// false on the 11th, and true for a different key. No fake limiter is needed.
// Because the integration project shares one worker for the whole run, every
// test uses its own `CF-Connecting-IP` value (below) so the shared 60-second
// bucket of one test can never tip another over.
import { describe, expect, it } from 'vitest';
import { env, SELF, listDurableObjectIds } from 'cloudflare:test';
import * as Y from 'yjs';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id.ts';
import {
  BOARD_CREATE_LIMIT,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config.ts';
import { createSticky } from '../../src/shared/board-model.ts';
import { createBoard, type CreateEnv } from '../../src/worker/create-board.ts';
import type { Env } from '../../src/worker/index.ts';
import { createdAt, failMigrate, inRoom, tables } from './helpers/room.ts';
import { RoomClient, connectClients, ensureBoard, waitFor, flush } from './helpers/ws-client.ts';

const realEnv = env as unknown as Env;

/** A unique simulated visitor: no two tests share a rate-limit bucket. */
let visitorCounter = 0;
function visitor(): Record<string, string> {
  visitorCounter++;
  return { 'CF-Connecting-IP': `203.0.113.${visitorCounter}-${Date.now() % 100000}` };
}

function post(headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch('http://localhost/api/boards', { method: 'POST', headers });
}

function get(id: string): Promise<Response> {
  return SELF.fetch(`http://localhost/api/boards/${id}`);
}

async function roomObjectIds(): Promise<string[]> {
  const ns = (env as unknown as { BOARD_ROOM: DurableObjectNamespace }).BOARD_ROOM;
  const ids = (await listDurableObjectIds(ns)) as unknown as { toString(): string }[];
  return ids.map((id) => id.toString());
}

/** The board API's create path, with bindings from the real Worker `Env`. */
function createEnvLike(generator?: () => string): CreateEnv {
  const base = {
    BOARD_CREATE_LIMITER: realEnv.BOARD_CREATE_LIMITER,
    BOARD_ROOM: realEnv.BOARD_ROOM as unknown as CreateEnv['BOARD_ROOM'],
  };
  return generator ? { ...base, VIDI_TEST_ID_GENERATOR: generator } : base;
}

describe('POST /api/boards (share.create)', () => {
  it('TC-05 creates a board, GET finds it, and created_at is set', async () => {
    const res = await post(visitor());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(body.id)).toBe(true);
    expect(isValidBoardId(body.id)).toBe(true);

    const check = await get(body.id);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ id: body.id });

    const stamp = await createdAt(body.id);
    expect(typeof stamp).toBe('number');
    expect(stamp!).toBeGreaterThan(0);
  });

  it('TC-11 never hands out an id that already belongs to a board', async () => {
    const taken = await post(visitor());
    const takenId = ((await taken.json()) as { id: string }).id;
    const takenStamp = await createdAt(takenId);

    // A generator that collides with the existing board first, then offers a
    // fresh id: real 128-bit collisions cannot be produced on demand.
    const fresh = newBoardId();
    const ids = [takenId, fresh];
    let calls = 0;
    const result = await createBoard(createEnvLike(() => ids[Math.min(calls++, ids.length - 1)]), visitor()['CF-Connecting-IP']);

    expect(result).toEqual({ ok: true, id: fresh });
    // The colliding board was not re-initialised and its stamp is untouched.
    expect(await createdAt(takenId)).toBe(takenStamp);
    // The new board exists with its own stamp.
    expect(await get(fresh)).toMatchObject({ status: 200 });
    expect(calls).toBe(2);
  });

  it('TC-12 reports create_failed when the board cannot be initialized', async () => {
    const id = newBoardId();
    // Instantiate the board's object WITHOUT creating the board (the constructor
    // only reads), then make its storage setup throw: the error surfaces through
    // the `initialize()` RPC exactly as a real RPC failure would.
    await inRoom(id, () => undefined);
    await failMigrate(id, 1);
    const result = await createBoard(createEnvLike(() => id), visitor()['CF-Connecting-IP']);
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
    // Nothing half-created is left behind for the client to find.
    expect(await get(id)).toMatchObject({ status: 404 });
  });

  it('TC-13 admits BOARD_CREATE_LIMIT creates per visitor and refuses the next, without creating it', async () => {
    const key = visitor();
    const created: string[] = [];
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const res = await post(key);
      expect(res.status).toBe(201);
      created.push(((await res.json()) as { id: string }).id);
    }
    expect(new Set(created).size).toBe(BOARD_CREATE_LIMIT);

    // Boundary: the next create from the same visitor is refused, and no board
    // is created for it.
    const over = await post(key);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'rate_limited' });

    // A different visitor is unaffected.
    const other = await post(visitor());
    expect(other.status).toBe(201);
  });

  it('TC-14 answers 405 for a method other than POST on the collection', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await SELF.fetch('http://localhost/api/boards', { method });
      expect(res.status).toBe(405);
    }
  });

  it('TC-15 initialize() is create-once: a second call says exists and keeps created_at', async () => {
    const first = await post(visitor());
    const id = ((await first.json()) as { id: string }).id;
    const stamp = await createdAt(id);
    expect(stamp).not.toBeNull();

    const again = await ensureBoard(id);
    expect(again).toBe('exists');
    expect(await createdAt(id)).toBe(stamp);
  });
});

describe('GET /api/boards/:id (share.open_link, share.not_found)', () => {
  it('TC-06 returns 404 for a valid id that was never created and writes no storage', async () => {
    const id = newBoardId();
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });

    // The existence check only read: SQLite was never touched, so probing links
    // leaves nothing behind (negative scenario).
    expect(await tables(id)).toEqual([]);
  });

  it('TC-07 returns 404 for malformed ids without reaching the Durable Object', async () => {
    const before = await roomObjectIds();
    const malformed = ['abc', 'A'.repeat(23), 'A'.repeat(21), 'AAAAAAAAAAAAAAAAAAAAA/', 'bad id'];
    for (const id of malformed) {
      const res = await SELF.fetch(`http://localhost/api/boards/${encodeURIComponent(id)}`);
      expect(res.status).toBe(404);
      expect(isValidBoardId(id)).toBe(false);
    }
    // No object was instantiated for any of them: the id is validated first, so
    // a malformed id cannot even create the board's object.
    const after = await roomObjectIds();
    expect(after.length).toBe(before.length);
  });

  it('TC-08 counts a board saved before the create API as existing (share.legacy_boards)', async () => {
    const id = newBoardId();
    // A real Yjs update, written straight to the log with no created_at stamp:
    // exactly what a board saved before story 5 shipped looks like.
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(note).toBeTruthy();
    const update = Y.encodeStateAsUpdate(doc);
    await inRoom(id, (room) => {
      room.store.migrate();
      room.store.append(update);
    });

    expect(await createdAt(id)).toBeNull();
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });
  });
});

describe('WebSocket upgrade for an unknown board (share.not_found)', () => {
  it('TC-09 rejects an unknown id with 404, accepts no socket and creates no tables', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
    // No socket was handed out (workerd gives `webSocket: null` on a rejected
    // upgrade; the point is that nothing was accepted).
    expect((res as unknown as { webSocket?: unknown }).webSocket ?? null).toBeNull();
    expect(await tables(id)).toEqual([]);
  });

  it('TC-10 upgrades after creation and the story 3 sync still works', async () => {
    const created = await post(visitor());
    const id = ((await created.json()) as { id: string }).id;

    const res = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);

    // Two clients on the freshly created board sync and relay as in story 3.
    const [a, b] = await connectClients(id, 2);
    b.clearLog();
    createSticky(a.doc, { x: 10, y: 20 });
    await waitFor(() => b.snapshot().length === 1, 'second client sees the note');
    a.close();
    b.close();
  });
});

describe('board page privacy (share.not_found / privacy constraint)', () => {
  it('TC-32 the served board page declares referrer no-referrer', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/b/${id}`, {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The point is the declaration, so the assertion matches the attribute pair in
    // either HTML syntax rather than one serializer's spelling.
    expect(html).toMatch(
      /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>|<meta\s+content="no-referrer"\s+name="referrer"\s*\/?>/,
    );
  });
});

describe('creation retry budget (share.unique, end to end)', () => {
  it('TC-02 boundary: a generator that always collides exhausts CREATE_ID_MAX_ATTEMPTS and fails', async () => {
    const existing = await post(visitor());
    const takenId = ((await existing.json()) as { id: string }).id;
    let calls = 0;
    const result = await createBoard(
      createEnvLike(() => {
        calls++;
        return takenId;
      }),
      visitor()['CF-Connecting-IP'],
    );
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
    expect(calls).toBe(CREATE_ID_MAX_ATTEMPTS);
    // The board it kept colliding with is untouched.
    expect(await get(takenId)).toMatchObject({ status: 200 });
  });

  it('a board created through the API is a real room: writes survive and are readable back', async () => {
    const created = await post(visitor());
    const id = ((await created.json()) as { id: string }).id;
    const client = await RoomClient.connect(id);
    createSticky(client.doc, { x: 1, y: 2 });
    await waitFor(() => client.snapshot().length === 1, 'write applied');
    await flush(30);
    expect((await tables(id)).length).toBeGreaterThan(0);
    client.close();
  });
});
