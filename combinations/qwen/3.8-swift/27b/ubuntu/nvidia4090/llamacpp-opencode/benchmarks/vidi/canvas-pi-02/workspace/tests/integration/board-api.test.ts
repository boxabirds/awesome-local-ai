// Story 5, share.board_api integration tests: the real Worker fetch handler,
// BoardRoom Durable Object RPC and SQLite in workerd (SELF.fetch), no mocks.
//
// TC-05 to TC-15, TC-32.
//
// Rate limiter note (TC-13): this workerd build does not implement the
// platform ratelimits binding (wrangler.local.jsonc omits it; see that
// file's header), so createBoard runs its in-memory fixed-window stand-in
// with the same limit and period (BOARD_CREATE_LIMIT /
// BOARD_CREATE_PERIOD_SECONDS). E2E runs against `wrangler dev`, which DOES
// implement the real binding. Both paths satisfy the same contract: the
// first BOARD_CREATE_LIMIT creates succeed, the next is refused, and a
// different visitor key is unaffected.

import { describe, expect, it, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import * as Y from 'yjs';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import {
  __testSetIdGenerator,
  __testSetInitialize,
} from '../../src/worker/create-board';
import type { BoardRoom } from '../../src/worker/board-room';
import { RoomClient, createNote } from './ws-client';

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
};

/** A distinct simulated visitor per test (CF-Connecting-IP). */
function visitor(ip: string): Record<string, string> {
  return { 'CF-Connecting-IP': ip };
}

async function postBoard(ip: string): Promise<Response> {
  return SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST', headers: visitor(ip) }));
}

async function getBoard(boardId: string): Promise<Response> {
  return SELF.fetch(new Request(`http://localhost/api/boards/${boardId}`));
}

async function roomStub(boardId: string): Promise<BoardRoom> {
  return (await env.BOARD_ROOM.get(
    env.BOARD_ROOM.idFromName(boardId),
  )) as unknown as BoardRoom;
}

/** One real Yjs update carrying one sticky note. */
function noteUpdate(): Uint8Array {
  const doc = new Y.Doc();
  createSticky(doc, { x: 10, y: 20 }, 'yellow');
  return Y.encodeStateAsUpdate(doc);
}

describe('share.board_api', () => {


  it('TC-05: POST /api/boards -> 201 with a valid id; GET 200; created_at set', async () => {
    const created = await postBoard('10.1.0.5');
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const found = await getBoard(body.id);
    expect(found.status).toBe(200);
    expect((await found.json()) as { id: string }).toEqual({ id: body.id });

    const createdRoom = await roomStub(body.id);
    const createdAt = await createdRoom.testGetCreatedAt();
    expect(createdAt).not.toBeNull();
    expect(createdAt!).toBeGreaterThan(0);
  });

  it('TC-06: GET a fresh never-created id -> 404 and NO storage written (negative)', async () => {
    const fresh = newBoardId();
    const res = await getBoard(fresh);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    // The existence check is read-only: sqlite_master has no app tables.
    const room = await roomStub(fresh);
    expect(await room.testTableNames()).toEqual([]);
    expect(await room.testGetCreatedAt()).toBeNull();
  });

  it('TC-07: malformed ids -> 404, the DO namespace is never touched (negative)', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    for (const bad of ['abc', 'a'.repeat(23), 'a b', 'a/b']) {
      const res = await getBoard(bad);
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-08: legacy board (updates row, no created_at) exists -> 200', async () => {
    const id = newBoardId();
    const room = await roomStub(id);
    expect(await room.testSeedLegacyUpdates([noteUpdate()])).toBe(1);
    expect(await room.testGetCreatedAt()).toBeNull(); // legacy: never created via API

    const res = await getBoard(id);
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toEqual({ id });
  });

  it('TC-09: WebSocket upgrade to an unknown id -> 404, no socket, no tables (negative)', async () => {
    const fresh = newBoardId();
    const res = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${fresh}`, { headers: UPGRADE_HEADERS }),
    );
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();

    const room = await roomStub(fresh);
    expect(await room.testTableNames()).toEqual([]);
  });

  it('TC-10: upgrade after creation -> 101 and story 3 sync works', async () => {
    const created = await postBoard('10.1.0.10');
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const a = await RoomClient.connect(id);
    await a.waitForSync();
    const b = await RoomClient.connect(id);
    await b.waitForSync();

    const noteId = createNote(a, 50, 50);
    await vi.waitFor(() => {
      expect(b.notes.map((n) => n.id)).toContain(noteId);
    });

    a.close();
    b.close();
  });

  it('TC-11: collision on an existing id is retried; the existing board is untouched', async () => {
    // An existing board with a known created_at.
    const first = await postBoard('10.1.0.11');
    expect(first.status).toBe(201);
    const existingId = ((await first.json()) as { id: string }).id;
    const existingRoom = await roomStub(existingId);
    const existingCreatedAt = await existingRoom.testGetCreatedAt();
    expect(existingCreatedAt).not.toBeNull();

    // The generator yields the EXISTING id first, then a fresh one.
    const fresh = newBoardId();
    const queued = [existingId, fresh];
    __testSetIdGenerator(() => queued.shift()!);
    try {
      const res = await postBoard('10.1.0.12');
      expect(res.status).toBe(201);
      expect((await res.json()) as { id: string }).toEqual({ id: fresh });
    } finally {
      __testSetIdGenerator(null);
    }

    // The existing board's created_at is unchanged (never re-initialised).
    expect(await (await roomStub(existingId)).testGetCreatedAt()).toBe(existingCreatedAt);
  });

  it('TC-12: initialize throwing -> 500 create_failed (error path)', async () => {
    __testSetInitialize(async () => {
      throw new Error('injected RPC failure');
    });
    try {
      const res = await postBoard('10.1.0.13');
      expect(res.status).toBe(500);
      expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });
    } finally {
      __testSetInitialize(null);
    }
  });

  it(`TC-13: ${BOARD_CREATE_LIMIT + 1} POSTs from one visitor -> first ${BOARD_CREATE_LIMIT} are 201, next 429; another IP is 201`, async () => {
    const ip = '10.1.0.14';
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const res = await postBoard(ip);
      expect(res.status, `attempt ${i + 1}`).toBe(201);
    }
    const limited = await postBoard(ip);
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: string }).toEqual({ error: 'rate_limited' });

    // A different visitor is unaffected.
    const other = await postBoard('10.1.0.15');
    expect(other.status).toBe(201);
  });

  it('TC-14: PUT /api/boards -> 405', async () => {
    const res = await SELF.fetch(
      new Request('http://localhost/api/boards', { method: 'PUT' }),
    );
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize() twice -> created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const room = await roomStub(id);
    expect(await room.initialize()).toBe('created');
    const first = await room.testGetCreatedAt();
    expect(first).not.toBeNull();

    // Shift the clock so a re-insert (should not happen) would be visible.
    await new Promise((r) => setTimeout(r, 5));
    expect(await room.initialize()).toBe('exists');
    expect(await room.testGetCreatedAt()).toBe(first);
  });

  it('TC-24: /_test/ hooks are absent without TEST_HOOKS (production config)', async () => {
    // This integration env has no TEST_HOOKS (wrangler.local.jsonc sets
    // none), i.e. the production shape: the hook route must not answer. It
    // falls through to the static SPA (an HTML document), never the hook's
    // JSON.
    expect(env.TEST_HOOKS).toBeUndefined();
    const id = newBoardId();
    const res = await SELF.fetch(new Request(`http://localhost/_test/${id}/state`));
    const ctype = res.headers.get('Content-Type') ?? '';
    expect(ctype).toContain('text/html');
    const body = await res.text();
    expect(body).not.toContain('"connectionState"');
  });

  it('TC-32: served index.html carries the no-referrer meta (privacy constraint)', async () => {
    const res = await SELF.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
