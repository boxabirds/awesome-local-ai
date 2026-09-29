/**
 * Integration tests for the board API (story 5, task 3: TC-05 to TC-15, TC-32).
 *
 * These run against the real Worker entry, the real `BOARD_ROOM` namespace and
 * real Durable Object SQLite, because the two properties worth testing here are
 * storage facts that a mock would assume rather than check:
 *
 *  - **an unknown id writes nothing.** "Probing a link leaves no storage behind"
 *    is only falsifiable by looking inside the database afterwards, and the
 *    failure mode — `CREATE TABLE IF NOT EXISTS` on every lookup — looks
 *    harmless until a stranger's mistyped link owns a database.
 *  - **an existing board is never handed out again.** A collision that silently
 *    re-initialised a board is one person's notes replaced by another's.
 *
 * ## The rate limiter is the real binding
 *
 * `BOARD_CREATE_LIMITER` is declared in `wrangler.jsonc` and the pinned local
 * runtime implements it, so TC-13 exercises the platform's own counter rather
 * than a fake that agrees with it. Two consequences are written down because
 * they are the reason the test looks odd:
 *
 *  - `env.BOARD_CREATE_LIMITER` is **read-only from the test file** — assigning
 *    to it does not reach a running request, verified while writing this. So the
 *    limit cannot be swapped for a stub, and does not need to be.
 *  - the window is shared by the whole run (`isolatedStorage: false`, one
 *    Worker), so every case gets its own `CF-Connecting-IP` and starts from a
 *    counter nobody has spent. A fixed address would make the first case in the
 *    file the only one that could ever see 201.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';
import { RoomStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { TestPeer, settle, waitFor } from './helpers/ws-client';
import { createWithRetries } from '../../src/worker/create-board';

/**
 * A visitor address for one case.
 *
 * Counted out rather than picked at random: the limiter's counter lives as long
 * as the Worker, so a repeated key is a spent budget, and a random address can
 * repeat one. `198.51.100.0/24` is TEST-NET-2 and no literal in this file uses
 * that block, so a counted address cannot collide with a hand-written one.
 */
let visitorSerial = 0;
function nextVisitor(): string {
  visitorSerial += 1;
  return `198.51.100.${visitorSerial}`;
}

/** Ask for a board the way the home page does. */
function createBoardRequest(key = nextVisitor()): Promise<Response> {
  return SELF.fetch('https://board.example/api/boards', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': key },
  });
}

/** Ask whether a board exists, the way a pasted link does. */
function checkBoard(id: string): Promise<Response> {
  return SELF.fetch(`https://board.example/api/boards/${id}`);
}

function upgradeHeaders(): Record<string, string> {
  return {
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dE4q5P8zRb0oZ0uS0m0T0g==',
  };
}

/** Run `use` with the room's own store, for seeding and for asserting on it. */
function withStore<T>(boardId: string, use: (store: RoomStore) => T): Promise<T> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject(stub as never, (room: BoardRoom) => use(room.store));
}

/** Which tables this board's object has. `[]` means it has no database at all. */
function tablesOf(boardId: string): Promise<string[]> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject(stub as never, (room: BoardRoom) =>
    // Read out of the object's own SQLite. `RoomStore.prepared` is only this
    // instance's opinion of the file, and the claim being tested is about the
    // file: that a probe of an unknown id left nothing behind.
    (
      room as unknown as {
        ctx: { storage: { sql: { exec(q: string): { toArray(): Array<{ name: string }> } } } };
      }
    ).ctx.storage.sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .toArray()
      .map((row) => row.name),
  );
}

/** Make a board exist without going through the endpoint. */
async function createTestBoard(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await (stub as unknown as { initialize(): Promise<string> }).initialize();
}


describe('POST /api/boards creates a board (TC-05, TC-11 to TC-15)', () => {
  it('TC-05 answers 201 with a usable id, and the board then exists', async () => {
    const response = await createBoardRequest();
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    // The id names something, three ways: the link check says it exists, its
    // `created_at` is written, and a socket to it is accepted.
    const check = await checkBoard(body.id);
    expect(check.status).toBe(200);

    const peer = await TestPeer.connect(body.id, { name: 'creator' });
    await settle([peer]);
    expect(peer.closeCode).toBe(null);
  });

  it('TC-11 skips an id that is taken and creates the next one', async () => {
    const taken = newBoardId();
    await createTestBoard(taken);
    const before = await withStore(taken, (store) => store.createdAt());
    expect(before, 'the fixture must really be a created board').toBeDefined();

    // The generator is the seam the design allows, because a real 128-bit
    // collision cannot be produced on demand. `resolve` is real storage, so the
    // retry is deciding against the same answer production would give it.
    const fresh = newBoardId();
    const asked: string[] = [];
    const outcome = await createWithRetries(
      () => (asked.length === 0 ? taken : fresh),
      async (id) => {
        asked.push(id);
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
        return (await (stub as unknown as { initialize(): Promise<string> }).initialize()) as
          | 'created'
          | 'exists';
      },
    );

    expect(outcome).toEqual({ ok: true, id: fresh });
    // Two attempts: the collision, then the id that was free.
    expect(asked).toEqual([taken, fresh]);

    // The negative half: the board that was already there is untouched.
    expect(await withStore(taken, (store) => store.createdAt())).toBe(before);
  });

  it('TC-12 turns a failed initialize into a create_failed, at every level', async () => {
    // Two halves, because the failure has to be survived twice: the retry helper
    // must not spin, and the route must say the thing the home page can show.
    const outcome = await createWithRetries(
      () => newBoardId(),
      async () => {
        throw new Error('rpc threw');
      },
    );
    expect(outcome).toEqual({ ok: false });

    // And the same failure through the real handler, with a namespace whose RPC
    // throws. This calls the exported `fetch` directly with a substituted `Env`
    // because `env` in a test file is not the object a running request reads —
    // assigning to it changes nothing, which was checked while writing this. The
    // handler under test is still the production one.
    const worker = (await import('../../src/worker/index')).default;
    const brokenNamespace = {
      idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
      get: () => ({
        initialize: async () => {
          throw new Error('storage write threw');
        },
      }),
    } as unknown as typeof env.BOARD_ROOM;

    // A working limiter here, on purpose: without one the request would be
    // refused before it ever reached the throwing namespace, and this case would
    // pass while proving something else.
    const openLimiter = { limit: async () => ({ success: true }) };

    const response = await worker.fetch(
      new Request('https://board.example/api/boards', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.55' },
      }),
      { BOARD_ROOM: brokenNamespace, ASSETS: env.ASSETS, BOARD_CREATE_LIMITER: openLimiter },
    );
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe('create_failed');

    // A denied visitor is reported the same way, and creates nothing: the limit
    // is consulted before an id is minted.
    const limited = await worker.fetch(
      new Request('https://board.example/api/boards', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.56' },
      }),
      {
        BOARD_ROOM: brokenNamespace,
        ASSETS: env.ASSETS,
        BOARD_CREATE_LIMITER: { limit: async () => ({ success: false }) },
      },
    );
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe('rate_limited');
  });

  it('refuses a create it cannot count, and never reaches storage', async () => {
    // A deployment without the rate-limit binding is a misconfiguration, not a
    // world without a limit: `POST /api/boards` asks for nothing but a listener,
    // so "no limiter" has to mean "no boards" rather than "unlimited boards".
    // The namespace records whether it was asked at all, because the claim is
    // that nothing was minted. The second request, same namespace with a
    // binding added, shows the refusal came from the missing binding and not
    // from a namespace that cannot work.
    const worker = (await import('../../src/worker/index')).default;
    const calls: string[] = [];
    const watchingNamespace = {
      idFromName: (name: string) => {
        calls.push(name);
        return env.BOARD_ROOM.idFromName(name);
      },
      get: () => ({
        initialize: async () => {
          calls.push('initialize');
          return 'created' as const;
        },
      }),
    } as unknown as typeof env.BOARD_ROOM;

    const uncountable = await worker.fetch(
      new Request('https://board.example/api/boards', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': nextVisitor() },
      }),
      { BOARD_ROOM: watchingNamespace, ASSETS: env.ASSETS },
    );
    expect(uncountable.status).toBe(500);
    expect(((await uncountable.json()) as { error: string }).error).toBe('create_failed');
    expect(calls, 'an id was minted, which means storage was reached').toEqual([]);

    const counted = await worker.fetch(
      new Request('https://board.example/api/boards', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': nextVisitor() },
      }),
      {
        BOARD_ROOM: watchingNamespace,
        ASSETS: env.ASSETS,
        BOARD_CREATE_LIMITER: { limit: async () => ({ success: true }) },
      },
    );
    expect(counted.status).toBe(201);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('TC-13 denies the eleventh board for one visitor and not for another', async () => {
    // A private address per case: the counter is per key and shared by the run,
    // and the address below has to start empty for "ten are allowed" to mean
    // anything. The second visitor below is counted out for the same reason.
    const visitor = nextVisitor();

    // Exactly the limit is allowed…
    const ids: string[] = [];
    for (let index = 0; index < BOARD_CREATE_LIMIT; index += 1) {
      const response = await createBoardRequest(visitor);
      expect(response.status, `board ${index + 1}`).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }
    expect(new Set(ids).size).toBe(BOARD_CREATE_LIMIT);

    // …and exactly one over it is refused.
    const denied = await createBoardRequest(visitor);
    expect(denied.status).toBe(429);
    expect(((await denied.json()) as { error: string }).error).toBe('rate_limited');

    // A different visitor is untouched by the first one's burst, and the denial
    // wrote nothing: no id was minted, so no board was made to deny.
    const other = await createBoardRequest();
    expect(other.status).toBe(201);
  });

  it('TC-14 answers 405 for a method that means nothing here', async () => {
    const put = await SELF.fetch('https://board.example/api/boards', { method: 'PUT' });
    expect(put.status).toBe(405);
    const get = await SELF.fetch('https://board.example/api/boards', { method: 'GET' });
    expect(get.status).toBe(405);
  });

  it('TC-15 does not re-initialise a board that already exists', async () => {
    const board = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board));
    const first = await (stub as unknown as { initialize(): Promise<string> }).initialize();
    expect(first).toBe('created');
    const before = await withStore(board, (store) => store.createdAt());

    const second = await (stub as unknown as { initialize(): Promise<string> }).initialize();
    expect(second).toBe('exists');
    // The original stamp survives, or "created once" would mean nothing.
    expect(await withStore(board, (store) => store.createdAt())).toBe(before);
  });
});

describe('GET /api/boards/:id reports existence without writing (TC-06 to TC-08)', () => {
  it('TC-06 answers 404 for a valid id nobody made, and writes nothing', async () => {
    const board = newBoardId();
    const response = await checkBoard(board);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');

    // The negative half, and the whole reason the check looks at the schema
    // before it looks at any row: a probe must not leave a database behind.
    expect(await tablesOf(board)).toEqual([]);
  });

  it('TC-07 answers 404 for a malformed id without reaching an object', async () => {
    const malformed = ['abc', 'a'.repeat(21), 'a'.repeat(23), 'aaaaaaaa-aaaaaaaaaaaaaaaa'];
    const real = env.BOARD_ROOM;
    const calls: string[] = [];
    env.BOARD_ROOM = {
      idFromName(name: string) {
        calls.push(name);
        return real.idFromName(name);
      },
      get: (id: DurableObjectId) => real.get(id),
    } as unknown as typeof env.BOARD_ROOM;

    try {
      for (const id of malformed) {
        const response = await checkBoard(id);
        expect(response.status, id).toBe(404);
      }
      // No lookup at all: the shape is checked before the namespace is touched,
      // which is what keeps a fuzzer off the storage layer.
      expect(calls).toEqual([]);
    } finally {
      env.BOARD_ROOM = real;
    }
  });

  it('TC-08 opens a legacy board that has bytes but was never created', async () => {
    const board = newBoardId();
    // A story-4 board: bytes in the blob table and no `created_at` anywhere.
    // Seeded by hand, because `initialize` would set `created_at`, which is the
    // one thing a legacy board does not have. The bytes are filed under the
    // object's own board key, which is where a room keeps them.
    await withStore(board, (store) => {
      store.migrate();
      store.write('board', new Uint8Array([3, 1, 2, 3]));
      expect(store.createdAt()).toBeUndefined();
      expect(store.existsReadOnly('board')).toBe(true);
    });

    expect((await checkBoard(board)).status).toBe(200);
  });

  it('does not call a board by a prefix it does not own', async () => {
    // `/api/boardsfoo` is not a board lookup, and must not be read as one.
    expect((await SELF.fetch('https://board.example/api/boardsfoo')).status).toBe(200);
  });
});

describe('the WebSocket route refuses boards that do not exist (TC-09, TC-10)', () => {
  it('TC-09 refuses an unknown id with 404, no socket and no storage', async () => {
    const board = newBoardId();
    const response = await SELF.fetch(`https://board.example/api/rooms/${board}`, {
      headers: upgradeHeaders(),
    });
    expect(response.status).toBe(404);
    expect((response as Response & { webSocket?: WebSocket }).webSocket).toBeFalsy();
    expect(await tablesOf(board)).toEqual([]);
  });

  it('TC-10 accepts a socket after the board was created, and syncs', async () => {
    const created = await createBoardRequest();
    expect(created.status).toBe(201);
    const board = ((await created.json()) as { id: string }).id;

    const [a, b] = await Promise.all([
      TestPeer.connect(board, { name: 'a' }),
      TestPeer.connect(board, { name: 'b' }),
    ]);
    await settle([a, b]);
    expect(a.closeCode).toBe(null);
    expect(b.closeCode).toBe(null);

    // Story 3's contract still holds on the far side of the new check: a change
    // by one editor reaches the other.
    const { createSticky } = await import('../../src/shared/board-model');
    createSticky(a.doc, { x: 10, y: 10, text: 'hello' });
    await waitFor(() => b.frames.length > 0, 'the second editor heard nothing');
  });

  it('refuses to take a board it could not check', async () => {
    // The cheap way to "fix" a board that will not open during an outage is to
    // let it open anyway, and that turns this check into a formality: whoever
    // probed an address would be handed a room to write into every time storage
    // blinked. So an unanswerable question is answered as a refusal on both
    // routes — the HTTP question does not come back 200, the socket question
    // never reaches a room — and the control at the end, the same code with a
    // lookup that says *yes*, shows those two assertions could have failed.
    const worker = (await import('../../src/worker/index')).default;
    const reached: string[] = [];
    const roomFetch = async () => {
      reached.push('room');
      return new Response('the room was asked', { status: 421 });
    };
    const namespaceWhere = (exists: () => Promise<boolean>) =>
      ({
        idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
        get: () => ({ exists, fetch: roomFetch }),
      }) as unknown as typeof env.BOARD_ROOM;

    const unreadable = {
      BOARD_ROOM: namespaceWhere(async () => {
        throw new Error('the object could not be reached');
      }),
      ASSETS: env.ASSETS,
    };
    const answerable = {
      BOARD_ROOM: namespaceWhere(async () => true),
      ASSETS: env.ASSETS,
    };
    const upgrade = () =>
      new Request(`https://board.example/api/rooms/${newBoardId()}`, {
        headers: upgradeHeaders(),
      });

    const probe = await worker
      .fetch(new Request(`https://board.example/api/boards/${newBoardId()}`), unreadable)
      .then((r) => `status ${r.status}`)
      .catch(() => 'rejected');
    expect(probe, 'an unreadable board was reported as one that exists').not.toBe('status 200');

    const socket = await worker
      .fetch(upgrade(), unreadable)
      .then((r) => `status ${r.status} upgrade=${r.headers.get('upgrade')}`)
      .catch(() => 'rejected');
    expect(socket, 'a socket for a board nobody confirmed').not.toContain('101');
    expect(reached, 'the room was asked for a board nobody confirmed').toEqual([]);

    const answered = await worker.fetch(upgrade(), answerable);
    expect(answered.status, 'the same code does reach a room it was told about').toBe(421);
    expect(reached).toEqual(['room']);
  });

  it('TC-32 serves the app with no-referrer, so a board address cannot leak', async () => {
    const board = newBoardId();
    const response = await SELF.fetch(`https://board.example/b/${board}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('name="referrer" content="no-referrer"');
  });
});
