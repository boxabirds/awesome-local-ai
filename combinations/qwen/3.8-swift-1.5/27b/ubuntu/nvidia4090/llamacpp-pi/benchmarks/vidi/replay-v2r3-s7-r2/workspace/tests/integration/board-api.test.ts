import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject, listDurableObjectIds } from 'cloudflare:test';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id';
import type { BoardRoom } from '../../src/worker/board-room';

function boardStub(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as DurableObjectStub<BoardRoom>;
}

/** Run a callback inside the board DO (avoids deep type instantiation). */
async function inBoard(boardId: string, fn: (instance: any) => unknown): Promise<unknown> {
  return runInDurableObject<BoardRoom, unknown>(
    boardStub(boardId),
    (instance) => fn(instance as any),
  );
}

/**
 * Story 5: board API integration tests against the real Worker (SELF.fetch)
 * and real Durable Object instances (RPC + runInDurableObject).
 *
 * Note on storage: vitest-pool-workers does not expose SQLite to Durable
 * Objects (useSQLite is stripped from DO designators), so the DO uses its
 * in-memory fallback here with identical semantics; SQLite-specific
 * persistence is covered by the e2e suite against `wrangler dev`.
 */

async function createBoard(): Promise<string> {
  const res = await SELF.fetch('http://x/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe('TC-05: POST /api/boards creates a board (share.board_api)', () => {
  it('returns 201 with a valid id; GET /api/boards/:id returns 200; created_at is set', async () => {
    const res = await SELF.fetch('http://x/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    expect((res.headers.get('content-type') || '').includes('application/json')).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(isValidBoardId(body.id)).toBe(true);

    const getRes = await SELF.fetch(`http://x/api/boards/${body.id}`);
    expect(getRes.status).toBe(200);

    const createdAt = await inBoard(body.id, (instance) => instance.store.getCreatedAt());
    expect(createdAt).not.toBeNull();
    expect(typeof createdAt).toBe('number');
  });
});

describe('TC-06: GET /api/boards/:id for unknown board (share.board_api)', () => {
  it('returns 404 and storage remains untouched', async () => {
    const unknownId = newBoardId();
    const res = await SELF.fetch(`http://x/api/boards/${unknownId}`);
    expect(res.status).toBe(404);

    const exists = await inBoard(unknownId, (instance) => instance.store.existsReadOnly());
    expect(exists).toBe(false);
  });
});

describe('TC-07: malformed board ids (share.board_api)', () => {
  it('GET /api/boards/<malformed> returns 404 without any RPC call', async () => {
    const before = (await listDurableObjectIds(env.BOARD_ROOM)).length;

    for (const bad of ['abc', 'way_too_long_board_id_value_1234567890', 'has!bad!chars']) {
      const res = await SELF.fetch(`http://x/api/boards/${bad}`);
      expect(res.status).toBe(404);
    }

    // No new Durable Objects were instantiated: the namespace was never touched.
    const after = (await listDurableObjectIds(env.BOARD_ROOM)).length;
    expect(after).toBe(before);
  });
});

describe('TC-08: legacy boards are recognized (share.legacy_boards)', () => {
  it('a board with updates rows but no created_at returns 200', async () => {
    const legacyId = newBoardId();
    const seedRes = await SELF.fetch(`http://x/__test/boards/${legacyId}/seed-legacy`, {
      method: 'POST',
    });
    expect(seedRes.status).toBe(200);

    const res = await SELF.fetch(`http://x/api/boards/${legacyId}`);
    expect(res.status).toBe(200);
  });
});

describe('TC-09: WebSocket upgrade for unknown board (share.not_found)', () => {
  it('returns 404 and leaves no storage behind', async () => {
    const unknownId = newBoardId();
    const req = new Request(`http://x/api/rooms/${unknownId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(404);

    const exists = await inBoard(unknownId, (instance) => instance.store.existsReadOnly());
    expect(exists).toBe(false);
  });
});

describe('TC-10: WebSocket upgrade after board creation (share.board_api)', () => {
  it('upgrade request is not 404 once the board exists', async () => {
    const boardId = await createBoard();
    const req = new Request(`http://x/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const res = await SELF.fetch(req);
    // In the test pool the non-hibernating WebSocket API is unavailable, so
    // the DO answers 200 to distinguish "exists" from 404; on the real
    // platform this is a 101 upgrade with full story-3 sync (covered by the
    // board-room protocol tests and the e2e suite).
    expect(res.status).not.toBe(404);
  });
});

describe('TC-12: failing initialize (share.board_api)', () => {
  it('POST /__test/api/boards with a throwing initialize returns 500 create_failed', async () => {
    const res = await SELF.fetch('http://x/__test/api/boards', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('create_failed');
  });
});

describe('TC-14: other methods on /api/boards (share.board_api)', () => {
  it('PUT /api/boards returns 405', async () => {
    const res = await SELF.fetch('http://x/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

describe('TC-15: initialize is idempotent (share.board_api)', () => {
  it('second initialize() returns exists and does not reset created_at', async () => {
    const boardId = newBoardId();
    const stub = boardStub(boardId);

    const first = await stub.initialize();
    expect(first).toBe('created');
    const createdAt1 = await inBoard(boardId, (instance) => instance.store.getCreatedAt());

    const second = await stub.initialize();
    expect(second).toBe('exists');
    const createdAt2 = await inBoard(boardId, (instance) => instance.store.getCreatedAt());

    expect(createdAt2).toBe(createdAt1);
  });
});

describe('TC-32: referrer policy (share.unguessable)', () => {
  it('the served index.html sets <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch('http://x/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
