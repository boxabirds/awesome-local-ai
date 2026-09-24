/**
 * Story 5 · board creation and existence, against the real Worker and the real
 * `BoardRoom` Durable Object (design "Test scopes": TC-05 … TC-15, TC-32).
 *
 * Everything here runs inside workerd with the app's own `wrangler.jsonc`, so
 * the Durable Object RPC, the SQLite-backed storage and the `BOARD_CREATE_LIMITER`
 * binding are the real ones (design "Mock vs real boundaries"). The only things
 * injected are the two things a test cannot produce for real: a 128-bit id
 * collision (TC-11) and a Durable Object whose RPC throws (TC-12).
 *
 * The two invariants the whole story rests on are asserted explicitly:
 *  - a request that does not create a board writes **nothing** (TC-06, TC-09);
 *  - a malformed id never instantiates a Durable Object (TC-07).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import { createBoard } from '../../src/worker/create-board';
import type { Env } from '../../src/worker/env';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** The real bindings, with the create limiter the app deploys with. */
const realEnv = env as unknown as Env;

function post(path: string, ip = '203.0.113.1'): Request {
  return new Request(`http://inner${path}`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  });
}

function get(path: string): Request {
  return new Request(`http://inner${path}`);
}

function upgrade(path: string): Request {
  return new Request(`http://inner${path}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
}

/** A distinct, syntactically valid id that nothing has ever touched. */
function freshId(): string {
  return newBoardId();
}

/** What the object's SQLite actually holds: the names of its tables. */
async function tablesOf(id: string): Promise<string[]> {
  const namespace = realEnv.BOARD_ROOM;
  if (namespace === undefined) throw new Error('BOARD_ROOM binding missing');
  const stub = namespace.get(namespace.idFromName(id));
  return runInDurableObject(stub, (_instance, state) => {
    const rows = (
      state.storage.sql.exec(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      ) as unknown as { toArray(): Array<Record<string, unknown>> }
    ).toArray();
    return rows.map((row) => String(row['name'])).sort();
  });
}

/** The board's `created_at` marker, or `undefined` when it has none. */
async function createdAtOf(id: string): Promise<number | undefined> {
  const namespace = realEnv.BOARD_ROOM;
  const stub = namespace!.get(namespace!.idFromName(id));
  return runInDurableObject(stub, (_instance, state) => {
    const cursor = state.storage.sql.exec(
      `SELECT value FROM storage_meta WHERE key = 'created_at'`,
    ) as unknown as { toArray(): Array<Record<string, unknown>> };
    const row = cursor.toArray()[0];
    return row === undefined ? undefined : Number(row['value']);
  });
}

describe('POST /api/boards (share.create)', () => {
  it('TC-05: creates a board, and the id it returns really exists', async () => {
    const response = await worker.fetch(post('/api/boards'), realEnv);
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // The created board answers 200 on the existence endpoint…
    const check = await worker.fetch(get(`/api/boards/${body.id}`), realEnv);
    expect(check.status).toBe(200);
    expect((await check.json()) as { id: string }).toEqual({ id: body.id });

    // …and it really was written: the `created_at` marker is the proof.
    expect(await createdAtOf(body.id)).toBeTypeOf('number');
  });

  it('TC-05b: two creates give different ids, and neither is derivable', async () => {
    const first = await worker.fetch(post('/api/boards', '203.0.113.10'), realEnv);
    const second = await worker.fetch(post('/api/boards', '203.0.113.11'), realEnv);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json() as { id: string }).id;
    const b = (await second.json() as { id: string }).id;
    // Different right from the first character: nothing is shared but chance.
    expect(a).not.toBe(b);
    expect(a.slice(0, 4)).not.toBe(b.slice(0, 4));
  });

  it('TC-14: another method on /api/boards is 405', async () => {
    const response = await worker.fetch(
      new Request('http://inner/api/boards', { method: 'PUT' }),
      realEnv,
    );
    expect(response.status).toBe(405);
  });

  it('TC-13: the eleventh create in a minute is refused, for that visitor only', async () => {
    const ip = '198.51.100.77';
    const other = '198.51.100.78';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < BOARD_CREATE_LIMIT; attempt += 1) {
      const response = await worker.fetch(post('/api/boards', ip), realEnv);
      statuses.push(response.status);
    }
    // Exactly the limit is allowed…
    expect(statuses).toEqual(new Array(BOARD_CREATE_LIMIT).fill(201));

    // …the next one is refused, and it creates nothing.
    const rejected = await worker.fetch(post('/api/boards', ip), realEnv);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({ error: 'rate_limited' });

    // A different visitor is unaffected (the limit is per visitor, not global).
    const untouched = await worker.fetch(post('/api/boards', other), realEnv);
    expect(untouched.status).toBe(201);
  });

  it('TC-11: a collided id is retried with a fresh one, and the existing board is untouched', async () => {
    const taken = freshId();
    const seed = Date.parse('2026-01-01T00:00:00.000Z');
    await runInDurableObject(
      realEnv.BOARD_ROOM!.get(realEnv.BOARD_ROOM!.idFromName(taken)),
      (_instance, state) => {
        state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        );
        state.storage.sql.exec(
          `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('created_at', ?)`,
          String(seed),
        );
      },
    );

    // Inject the collision: the first id handed out is the taken one, the
    // second is fresh. A real 128-bit collision cannot be produced on demand.
    const queue = [taken, freshId()];
    const result = await createBoard(realEnv, '203.0.113.20', {
      generate: () => queue.shift() ?? freshId(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The new board is the *retry*, never the address that was already taken.
    expect(result.id).not.toBe(taken);

    // Negative: the existing board was not re-initialised — its marker is
    // byte-identical, so nobody reset a live board by colliding with it.
    expect(await createdAtOf(taken)).toBe(seed);
  });

  it('TC-12: a Durable Object whose RPC throws answers 500', async () => {
    const reached: string[] = [];
    const brokenEnv: Env = {
      ASSETS: realEnv.ASSETS,
      BOARD_CREATE_LIMITER: realEnv.BOARD_CREATE_LIMITER,
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: (id: string) => {
          reached.push(id);
          throw new Error('rpc unavailable');
        },
      } as unknown as Env['BOARD_ROOM'],
    };

    const response = await worker.fetch(post('/api/boards', '203.0.113.30'), brokenEnv);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'create_failed' });
    // Negative: a thrown RPC is terminal, not retried three times against a
    // broken object, and nothing was created anywhere.
    expect(reached.length).toBe(1);
  });

  it('TC-15: creating the same board twice keeps the first creation', async () => {
    const id = freshId();
    const seed = Date.parse('2026-02-02T00:00:00.000Z');
    const stub = realEnv.BOARD_ROOM!.get(realEnv.BOARD_ROOM!.idFromName(id));
    const room = stub as unknown as {
      initialize(): Promise<'created' | 'exists'>;
    };

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      state.storage.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)`,
        String(seed),
      );
    });

    // A board that already has a marker reports `exists`, changes nothing.
    expect(await room.initialize()).toBe('exists');
    expect(await createdAtOf(id)).toBe(seed);

    // A fresh object creates once, then reports itself taken.
    const freshId_ = freshId();
    const fresh = realEnv.BOARD_ROOM!.get(realEnv.BOARD_ROOM!.idFromName(freshId_));
    const freshRoom = fresh as unknown as {
      initialize(): Promise<'created' | 'exists'>;
    };
    expect(await freshRoom.initialize()).toBe('created');
    const first = await createdAtOf(freshId_);
    expect(await freshRoom.initialize()).toBe('exists');
    expect(await createdAtOf(freshId_)).toBe(first);
  });
});

describe('GET /api/boards/:id (share.not_found, share.legacy_boards)', () => {
  it('TC-06: a valid but unknown id is 404 and leaves no storage behind', async () => {
    const id = freshId();
    const response = await worker.fetch(get(`/api/boards/${id}`), realEnv);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // Negative: probing did not create the board it was asking about.
    expect(await tablesOf(id)).toEqual([]);
  });

  it('TC-07: malformed ids are 404 and never reach a Durable Object', async () => {
    const touched: string[] = [];
    const watchedEnv: Env = {
      ASSETS: realEnv.ASSETS,
      BOARD_CREATE_LIMITER: realEnv.BOARD_CREATE_LIMITER,
      BOARD_ROOM: {
        idFromName: (name: string) => {
          touched.push(name);
          return name;
        },
        get: (id: string) => {
          touched.push(id);
          throw new Error('a Durable Object was instantiated for a malformed id');
        },
      } as unknown as Env['BOARD_ROOM'],
    };

    // Wrong length or wrong alphabet: each is a board address that cannot be a
    // board, and each answers the same way an unknown one does.
    for (const path of [
      '/api/boards/abc',
      '/api/boards/AAAAAAAAAAAAAAAAAAA', // 21 characters
      '/api/boards/AAAAAAAAAAAAAAAAAAAAAAA', // 23 characters
      '/api/boards/AAAAAAAAAAAAAAAAAAAAAA!', // right length, not URL-safe
      '/api/boards/AAAAAAAAAAAAAAAAAAAAAAa', // URL-safe, but not a 16-byte code
    ]) {
      const response = await worker.fetch(get(path), watchedEnv);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }

    // Anything deeper than one segment is not a board address at all, so it is
    // the app's business, not the API's — and it still reaches no object.
    const app = await worker.fetch(get('/api/boards/.well-known/thing'), watchedEnv);
    expect(app.status).not.toBe(404);

    // Negative: nothing was instantiated to answer any of the above.
    expect(touched).toEqual([]);
  });

  it('TC-08: a board with saved content but no marker still opens', async () => {
    // The legacy shape this exists for: content written before the creation
    // marker existed (PRD share.legacy_boards). It must not read as "not found".
    const id = freshId();
    await runInDurableObject(
      realEnv.BOARD_ROOM!.get(realEnv.BOARD_ROOM!.idFromName(id)),
      (_instance, state) => {
        state.storage.sql.exec(
          `CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
        );
        state.storage.sql.exec(
          `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
          new Uint8Array([0x00, 0x01, 0x02]).buffer,
          3,
        );
      },
    );

    const response = await worker.fetch(get(`/api/boards/${id}`), realEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id });
  });

  it('TC-08b: a legacy board that holds nothing is not a board', async () => {
    // Empty tables with no marker are a storage artefact, not content: it was
    // never a board, so it must not be handed out as one.
    const id = freshId();
    await runInDurableObject(
      realEnv.BOARD_ROOM!.get(realEnv.BOARD_ROOM!.idFromName(id)),
      (_instance, state) => {
        state.storage.sql.exec(
          `CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
        );
      },
    );
    const response = await worker.fetch(get(`/api/boards/${id}`), realEnv);
    expect(response.status).toBe(404);
  });
});

describe('GET /api/rooms/:id (share.open_link, share.not_found)', () => {
  it('TC-09: an upgrade to an unknown room is 404, with no socket and no storage', async () => {
    const id = freshId();
    const response = await worker.fetch(upgrade(`/api/rooms/${id}`), realEnv);
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeFalsy();

    // Negative: the refused probe created nothing, and the id stays unknown,
    // so a second probe answers the same way.
    expect(await tablesOf(id)).toEqual([]);
    const again = await worker.fetch(upgrade(`/api/rooms/${id}`), realEnv);
    expect(again.status).toBe(404);
  });

  it('TC-09b: an upgrade to a malformed room id is 404', async () => {
    const response = await worker.fetch(
      upgrade('/api/rooms/not-a-valid-board-id'),
      realEnv,
    );
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeFalsy();
  });

  it('TC-10: after a create the room opens, and a plain GET is 426', async () => {
    const created = await worker.fetch(post('/api/boards', '203.0.113.41'), realEnv);
    expect(created.status).toBe(201);
    const id = (await created.json() as { id: string }).id;

    const opened = await worker.fetch(upgrade(`/api/rooms/${id}`), realEnv);
    expect(opened.status).toBe(101);
    expect(opened.webSocket).toBeTruthy();
    opened.webSocket?.accept();
    opened.webSocket?.close();

    // The same path without an upgrade is a client error, not the app.
    const plain = await worker.fetch(get(`/api/rooms/${id}`), realEnv);
    expect(plain.status).toBe(426);
  });
});

describe('privacy (share.referrer)', () => {
  it('TC-32: the served document tells the browser to send no referrer', async () => {
    const response = await worker.fetch(get('/b/some-board-path'), realEnv);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(
      /<meta[^>]+name=["']referrer["'][^>]+content=["']no-referrer["']/i,
    );
  });
});
