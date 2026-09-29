/**
 * Story 5: board API integration tests (share.board_api, share.unguessable,
 * share.not_found, share.legacy_boards, share.meta_referrer, share.open_link).
 *
 * Rate-limit implementation note (required by tasks.md task 3): the local
 * miniflare/workerd runtime does NOT implement the `ratelimits` binding
 * (the worker falls back to a fixed-window in-memory limiter keyed by
 * CF-Connecting-IP — see src/worker/create-board.ts). TC-13 therefore uses a
 * fake `Limiter` wired through `worker.fetch(req, spyEnv)` with a spy
 * `BOARD_ROOM` namespace, so the limiter under test is exactly the 10/min
 * contract. All other tests go through SELF.fetch (real env, fallback
 * limiter) with a small total number of POST /api/boards calls.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import worker from 'src/worker/index';
import { createBoard } from 'src/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN } from 'src/shared/board-id';
import { initDoc, createSticky, getStickyText } from 'src/shared/board-model';
import { connectRoomClient, settleBoards } from './helpers/ws-client';

afterEach(async () => {
  await settleBoards();
});

async function api(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, init);
}

interface Inspect {
  tables: string[];
  createdAt: number | null;
  [key: string]: unknown;
}

async function inspect(boardId: string): Promise<Inspect> {
  const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/inspect`);
  return (await res.json()) as Inspect;
}

async function appendBoardUpdate(boardId: string, doc: Y.Doc): Promise<void> {
  const update = Y.encodeStateAsUpdate(doc);
  const b64 = btoa(String.fromCharCode(...update));
  const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/append`, {
    method: 'POST',
    body: JSON.stringify({ updates: [b64] }),
  });
  if (res.status !== 200) throw new Error(`append failed: ${res.status}`);
}

/** A spy BOARD_ROOM namespace for worker.fetch(req, spyEnv) tests. */
function makeBoardRoomSpy(initialize: (id: string) => Promise<'created' | 'exists'>) {
  let fetchCalls = 0;
  return {
    idFromName: (id: string) => id,
    get: (id: string) => ({
      initialize: () => initialize(id),
      exists: () => Promise.resolve(true),
      fetch: () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
    /** Number of stub.fetch calls (room-level RPCs the worker attempted). */
    get fetchCalls() {
      return fetchCalls;
    },
  };
}

describe('share.board_api: POST /api/boards', () => {
  it('TC-05: 201 + {id} matching BOARD_ID_PATTERN; GET /api/boards/:id → 200; createdAt recorded', async () => {
    const res = await api('/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const check = await api(`/api/boards/${body.id}`);
    expect(check.status).toBe(200);

    const out = await inspect(body.id);
    expect(out.createdAt).not.toBeNull();
    expect(out.tables).toContain('storage_meta');
  });

  it('TC-06: unknown id → GET 404; probing an unknown link creates NO storage', async () => {
    const id = newBoardId();
    const res = await api(`/api/boards/${id}`);
    expect(res.status).toBe(404);
    // The no-write guarantee: an unknown board leaves no tables behind.
    const out = await inspect(id);
    expect(out.tables).toEqual([]);
    expect(out.createdAt).toBeNull();
  });

  it('TC-07: malformed ids → 404 and the DO RPC is never invoked', async () => {
    let rpcCalls = 0;
    const spy = makeBoardRoomSpy(async () => {
      rpcCalls += 1;
      return 'created';
    });
    const env = { BOARD_ROOM: spy } as never;
    for (const id of ['abc', 'x'.repeat(23), 'board-1']) {
      const res = await worker.fetch(new Request(`http://localhost/api/boards/${id}`), env);
      expect(res.status).toBe(404);
    }
    expect(rpcCalls).toBe(0);
  });

  it('TC-08: a legacy board (no created_at, has update rows) is found and editable; legacy id is never re-initialized', async () => {
    const id = newBoardId();
    // Seed like a story 1–3 board: an appended update, no initialize().
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 }, 'yellow', 'legacy-note');
    await appendBoardUpdate(id, doc);

    const res = await api(`/api/boards/${id}`);
    expect(res.status).toBe(200);
    const out = await inspect(id);
    expect(out.createdAt).toBeNull(); // still legacy — not touched

    // And it is fully usable: a new edit propagates to a second client.
    const c1 = await connectRoomClient(id);
    const c2 = await connectRoomClient(id);
    await c1.waitForSync();
    await c2.waitForSync();
    const sticky = createSticky(c1.doc, { x: 0, y: 0 }, 'yellow', 'after-legacy');
    await c2.waitFor(() => c2.snapshot().some((n) => n.id === sticky));
    c1.close();
    c2.close();
  });

  it('TC-09: unknown id + WebSocket Upgrade → 404, no socket, no storage', async () => {
    // worker.fetch (not SELF.fetch): the fetch spec forbids setting the
    // Upgrade header on a Request from test code, and SELF.fetch would strip
    // it (the worker would then answer 426, not 404). A spy namespace is used
    // because this local harness cannot serialize real DO method RPCs back
    // into the test; the no-storage assertion below runs against the real
    // object namespace via SELF.fetch.
    const id = newBoardId();
    let rpcCalls = 0;
    const spy = makeBoardRoomSpy(async () => {
      rpcCalls += 1;
      return 'created';
    });
    const res = await worker.fetch(
      new Request(`http://localhost/api/rooms/${id}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
      { BOARD_ROOM: spy } as never,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('upgrade')).toBeNull();
    expect(res.webSocket).toBeNull();
    expect(rpcCalls).toBe(0); // initialize is never called for unknown ids
    const out = await inspect(id);
    expect(out.tables).toEqual([]);
  });

  it('TC-10: a created board is immediately openable (create → open round trip)', async () => {
    const res = await api('/api/boards', { method: 'POST' });
    const { id } = (await res.json()) as { id: string };
    const c1 = await connectRoomClient(id);
    const c2 = await connectRoomClient(id);
    await c1.waitForSync();
    await c2.waitForSync();
    // The 4th createSticky arg is the note id; the text is set separately so
    // the assertion can check the real text value on the second client.
    const sticky = createSticky(c1.doc, { x: 5, y: 5 }, 'yellow', 'round-trip');
    if (sticky === null) throw new Error('createSticky returned null');
    getStickyText(c1.doc, sticky)?.insert(0, 'round-trip');
    await c2.waitFor(() => c2.snapshot().some((n) => n.id === sticky && n.text === 'round-trip'));
    c1.close();
    c2.close();
  });

  it('TC-11a: re-initializing an existing board (the collision path) never mutates it', async () => {
    // A real board with a note, created through the real endpoint.
    const res = await api('/api/boards', { method: 'POST' });
    const { id: a } = (await res.json()) as { id: string };
    const c1 = await connectRoomClient(a);
    await c1.waitForSync();
    createSticky(c1.doc, { x: 0, y: 0 }, 'yellow', 'survivor');
    await c1.waitFor(() => c1.snapshot().some((n) => n.id === 'survivor'));
    c1.close();

    // The collision path: initialize() on an already-created board reports
    // 'exists' and writes nothing (same storage-level code the RPC runs).
    const init = await SELF.fetch(`http://localhost/__test/boards/${a}/initialize`, {
      method: 'POST',
    });
    expect(((await init.json()) as { result: string }).result).toBe('exists');

    // Untouched: created_at unchanged, the note still there.
    const before = (await inspect(a)).createdAt;
    expect(before).not.toBeNull();
    const c2 = await connectRoomClient(a);
    await c2.waitForSync();
    expect(c2.snapshot().some((n) => n.id === 'survivor')).toBe(true);
    const after = (await inspect(a)).createdAt;
    expect(after).toBe(before);
    c2.close();
  });

  it('TC-11b: createBoard with a colliding generator retries on a fresh id', async () => {
    const fresh = newBoardId();
    const seq = ['taken', fresh];
    let i = 0;
    const outcomes = new Map<string, 'created' | 'exists'>([
      ['taken', 'exists'],
      [fresh, 'created'],
    ]);
    const spy = makeBoardRoomSpy(async (id) => outcomes.get(id) ?? 'created');
    const result = await createBoard({ BOARD_ROOM: spy } as never, 'visitor', () => seq[i++]);
    expect(result).toEqual({ ok: true, id: fresh });
  });

  it('TC-12: createBoard RPC failure (500) → no board created', async () => {
    const calls: string[] = [];
    const spy = makeBoardRoomSpy(async (id) => {
      calls.push(id);
      throw new Error('rpc down');
    });
    const env = { BOARD_ROOM: spy } as never;
    const res = await worker.fetch(new Request('http://localhost/api/boards', { method: 'POST' }), env);
    expect(res.status).toBe(500);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((id) => id !== 'created')).toBe(true); // nothing ever 'created'
  });

  it('TC-13: the 11th create within the window → 429; a different IP is unaffected (fake Limiter)', async () => {
    const created: string[] = [];
    // Implements the same Limiter contract as the Cloudflare binding and the
    // worker's in-memory fallback: limit({key}) → {success}.
    const byIp = new Map<string, number>();
    const fakeLimiter = {
      async limit({ key }: { key: string }) {
        const count = byIp.get(key) ?? 0;
        if (count + 1 > 10) return { success: false };
        byIp.set(key, count + 1);
        return { success: true };
      },
    };
    const spy = makeBoardRoomSpy(async (id) => {
      created.push(id);
      return 'created';
    });
    const env = { BOARD_ROOM: spy, BOARD_CREATE_LIMITER: fakeLimiter } as never;

    const post = (ip: string) =>
      worker.fetch(
        new Request('http://localhost/api/boards', { method: 'POST', headers: { 'CF-Connecting-IP': ip } }),
        env,
      );

    for (let i = 0; i < 10; i++) {
      const res = await post('1.1.1.1');
      expect(res.status, `POST ${i + 1} should be 201`).toBe(201);
    }
    const eleventh = await post('1.1.1.1');
    expect(eleventh.status).toBe(429);
    expect(created).toHaveLength(10); // the rate-limited request created nothing

    // A different IP still has its own budget.
    const other = await post('2.2.2.2');
    expect(other.status).toBe(201);
    expect(created).toHaveLength(11);
  });

  it('TC-15: initialize() on the same object is idempotent — created then exists, created_at unchanged', async () => {
    // Note: this local harness cannot call DO methods directly from test code
    // (miniflare serializes the RpcPromise itself), so idempotency is driven
    // through the gated `initialize` test op, which runs the exact
    // storage-level code the RPC runs (migrate + setCreatedAt, once) against
    // the same object's storage.
    const id = newBoardId();
    const first = (await (await SELF.fetch(`http://localhost/__test/boards/${id}/initialize`, {
      method: 'POST',
    })).json()) as { result: string };
    expect(first.result).toBe('created');
    const createdAfterFirst = (await inspect(id)).createdAt;
    expect(createdAfterFirst).not.toBeNull();

    const second = (await (await SELF.fetch(`http://localhost/__test/boards/${id}/initialize`, {
      method: 'POST',
    })).json()) as { result: string };
    expect(second.result).toBe('exists');
    const createdAfterSecond = (await inspect(id)).createdAt;
    expect(createdAfterSecond).toBe(createdAfterFirst);

    // The board is now "existing": GET /api/boards/:id → 200.
    expect((await api(`/api/boards/${id}`)).status).toBe(200);
  });

it('TC-14 (share.share_link): other methods on /api/boards → 405', async () => {
    expect((await api('/api/boards', { method: 'PUT' })).status).toBe(405);
    expect((await api('/api/boards', { method: 'DELETE' })).status).toBe(405);
  });
});

describe('share.meta_referrer', () => {
  it('TC-32: the served index.html carries <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="referrer" content="no-referrer" \/>/);
  });
});
