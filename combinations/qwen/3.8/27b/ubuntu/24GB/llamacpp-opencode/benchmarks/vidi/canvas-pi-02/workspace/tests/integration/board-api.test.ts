/**
 * Story 5 integration tests: share.board_api (TC-05 to TC-15, TC-32).
 *
 * Runs against the real Worker + Durable Objects in workerd (miniflare).
 *
 * Rate limiter: the vitest pool does not support local rate limiters, so the
 * worker uses a no-op limiter (documented in the wrangler-test.jsonc header).
 * TC-13 is skipped because the no-op limiter never returns 429.
 *
 * Id generator injection: TC-11 and TC-12 call createBoard directly with an
 * injected generator (the 128-bit random generator cannot produce collisions
 * on demand).
 */
import { SELF, env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
} from '../../src/shared/config';
import { createBoard, createWithRetries } from '../../src/worker/create-board';
import type { BoardRoom } from '../../src/worker/board-room';

// --- TC-05: POST creates a board, GET confirms it ----------------------------

describe('TC-05 POST /api/boards creates a board', () => {
  it('returns 201 with a valid id; GET that id returns 200; created_at is set', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(body.id)).toBe(true);

    // GET the board
    const getRes = await SELF.fetch(`http://localhost/api/boards/${body.id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { id: string };
    expect(getBody.id).toBe(body.id);

    // Verify created_at is set in storage
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(body.id));
    const createdAt = await runInDurableObject(stub, (room: BoardRoom) =>
      room.storeForTest.getCreatedAt(),
    );
    expect(createdAt).not.toBeNull();
    expect(createdAt!).toBeGreaterThan(0);
  });
});

// --- TC-06: GET unknown id → 404, no storage written -------------------------

describe('TC-06 GET unknown id returns 404 with no storage', () => {
  it('returns 404; sqlite_master has no tables for that board', async () => {
    const freshId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${freshId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');

    // Verify no tables were created (existsReadOnly should be false)
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(freshId));
    const exists = await runInDurableObject(stub, (room: BoardRoom) =>
      room.storeForTest.existsReadOnly(),
    );
    expect(exists).toBe(false);
  });
});

// --- TC-07: malformed ids → 404, no RPC --------------------------------------

describe('TC-07 malformed ids return 404 without RPC', () => {
  it('GET /api/boards/abc → 404; GET /api/boards/<23 chars> → 404; no DO created', async () => {
    const before = await listDurableObjectIds(env.BOARD_ROOM);

    const res1 = await SELF.fetch('http://localhost/api/boards/abc');
    expect(res1.status).toBe(404);

    const long23 = 'a'.repeat(23);
    const res2 = await SELF.fetch(`http://localhost/api/boards/${long23}`);
    expect(res2.status).toBe(404);

    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after).toEqual(before);
  });
});

// --- TC-08: legacy board (updates row, no created_at) → 200 ------------------

describe('TC-08 legacy board (data without created_at) is found', () => {
  it('seed an updates row without created_at; GET returns 200', async () => {
    const boardId = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

    // Seed a legacy board: create tables and an updates row, but NO created_at.
    await runInDurableObject(stub, (room: BoardRoom) => {
      const store = room.storeForTest;
      store.migrate();
      // Insert a dummy updates row (not a valid Yjs update, but enough to
      // make the board "exist" per the legacy rule).
      store.append(new Uint8Array([0x00]));
    });

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}`);
    expect(res.status).toBe(200);
  });
});

// --- TC-09: unknown id → 404, no tables -------------------------------------

describe('TC-09 unknown board returns 404 with no tables', () => {
  it('GET /api/boards/<unknown> → 404; no tables created', async () => {
    const freshId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${freshId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');

    // Verify no tables were created
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(freshId));
    const exists = await runInDurableObject(stub, (room: BoardRoom) =>
      room.storeForTest.existsReadOnly(),
    );
    expect(exists).toBe(false);
  });
});

// --- TC-10: upgrade after POST → 101 (story 3 sync) ---------------------------

describe('TC-10 WebSocket upgrade after creation works', () => {
  it('POST then upgrade → 101', async () => {
    const createRes = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const wsRes = await SELF.fetch(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(wsRes.status).toBe(101);
  });
});

// --- TC-11: collision → fresh id; existing board unchanged -------------------

describe('TC-11 collision returns fresh id; existing board unchanged', () => {
  it('injected generator returns existing id then fresh → 201 fresh id', async () => {
    // Create a board first
    const res1 = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(res1.status).toBe(201);
    const { id: existingId } = (await res1.json()) as { id: string };

    // Read the existing board's created_at
    const stub1 = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(existingId));
    const createdAtBefore = await runInDurableObject(stub1, (room: BoardRoom) =>
      room.storeForTest.getCreatedAt(),
    );

    // Call createBoard directly with a generator that returns existingId first.
    // The env doesn't have BOARD_CREATE_LIMITER (test config), so pass a no-op.
    const freshId = newBoardId();
    let genCall = 0;
    const noopLimiter = { limit: async () => ({ success: true }) };
    const result = await createBoard(
      { ...env, BOARD_CREATE_LIMITER: noopLimiter },
      'test-visitor-tc11',
      () => genCall++ === 0 ? existingId : freshId,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe(freshId);
    }

    // Verify the existing board's created_at is unchanged
    const createdAtAfter = await runInDurableObject(stub1, (room: BoardRoom) =>
      room.storeForTest.getCreatedAt(),
    );
    expect(createdAtAfter).toBe(createdAtBefore);
  });
});

// --- TC-12: initialize throws → 500 create_failed ----------------------------

describe('TC-12 initialize throws returns create_failed', () => {
  it('injected failing initialize → {ok:false, reason:create_failed}', async () => {
    const boardId = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

    // Migrate first (so setMeta can write), then set the fail flag
    await runInDurableObject(stub, (room: BoardRoom) => {
      room.storeForTest.migrate();
      room.storeForTest.setFailInitializeFlag();
    });

    // Call createBoard directly with a generator that returns boardId.
    // The env doesn't have BOARD_CREATE_LIMITER (test config), so pass a no-op.
    const noopLimiter = { limit: async () => ({ success: true }) };
    const result = await createBoard(
      { ...env, BOARD_CREATE_LIMITER: noopLimiter },
      'test-visitor-tc12',
      () => boardId,
    );
    expect(result).toEqual({ ok: false, reason: 'create_failed' });

    // Clean up
    await runInDurableObject(stub, (room: BoardRoom) => {
      room.storeForTest.clearFailInitializeFlag();
    });
  });
});

// --- TC-13: rate limit boundary ----------------------------------------------

describe('TC-13 rate limit: BOARD_CREATE_LIMIT + 1 from same IP', () => {
  // The vitest pool does not support local rate limiters (wrangler-test.jsonc
  // omits the ratelimits section). The worker uses a no-op limiter, so 429
  // is never returned. This test is skipped; the rate-limit logic is covered
  // by the unit tests (TC-01/TC-02) and the E2E test (TC-30).
  it.skip(`first ${BOARD_CREATE_LIMIT} → 201; next → 429; different IP → 201`, async () => {
    // (skipped — see comment above)
  });
});

// --- TC-14: wrong method → 405 ------------------------------------------------

describe('TC-14 wrong method on /api/boards returns 405', () => {
  it('PUT /api/boards → 405', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('DELETE /api/boards → 405', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

// --- TC-15: initialize() twice → created then exists --------------------------

describe('TC-15 initialize() twice: created then exists', () => {
  it('first call → created; second → exists; created_at unchanged', async () => {
    const boardId = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

    const first = await runInDurableObject(stub, (room: BoardRoom) =>
      room.initialize(),
    );
    expect(first).toBe('created');

    const createdAt = await runInDurableObject(stub, (room: BoardRoom) =>
      room.storeForTest.getCreatedAt(),
    );

    const second = await runInDurableObject(stub, (room: BoardRoom) =>
      room.initialize(),
    );
    expect(second).toBe('exists');

    const createdAtAfter = await runInDurableObject(stub, (room: BoardRoom) =>
      room.storeForTest.getCreatedAt(),
    );
    expect(createdAtAfter).toBe(createdAt);
  });
});

// --- TC-32: index.html has no-referrer meta -----------------------------------

describe('TC-32 index.html has no-referrer meta', () => {
  it('served index.html contains <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta name="referrer" content="no-referrer"');
  });
});
