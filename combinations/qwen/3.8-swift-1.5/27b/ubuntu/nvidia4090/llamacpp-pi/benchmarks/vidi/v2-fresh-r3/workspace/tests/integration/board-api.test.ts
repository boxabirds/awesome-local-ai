/**
 * Story 5 — board creation and existence API (share.board_api).
 *
 * Runs against the in-process workerd pool: real Worker request handling,
 * real Durable Object RPC and real SQLite. Storage facts are inspected with
 * `runInDurableObject`; WebSocket upgrades via `SELF.fetch` +
 * `response.webSocket` (same pattern as persistent-room.test.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env, runInDurableObject, reset } from 'cloudflare:test';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import {
  newBoardId,
  BOARD_ID_PATTERN,
} from '../../src/shared/board-id';
import { BoardRoom, type StorageInfo } from '../../src/worker/board-room';
import { MESSAGE_SYNC } from '../../src/shared/protocol';
import { makeSingleNoteUpdate } from '../fixtures/boards';

beforeEach(async () => {
  await reset();
});

// --- helpers ----------------------------------------------------------------

async function postBoard(): Promise<Response> {
  return SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
}

async function getBoard(id: string): Promise<Response> {
  return SELF.fetch(new Request(`http://localhost/api/boards/${id}`));
}

async function storageInfo(id: string): Promise<StorageInfo> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return runInDurableObject<BoardRoom, StorageInfo>(stub, (room) => room.__testStorageInfo());
}

async function namespaceGets(): Promise<number> {
  const res = await SELF.fetch(new Request('http://localhost/__test/namespace-gets'));
  return (await res.json() as { count: number }).count;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function syncFrame(payload: Uint8Array): Uint8Array {
  const f = new Uint8Array(1 + payload.length);
  f[0] = MESSAGE_SYNC;
  f.set(payload, 1);
  return f;
}

/** An empty SyncStep1, used by a joiner to request the room's full state. */
function emptySyncStep1(): Uint8Array {
  const doc = new Y.Doc();
  const enc = createEncoder();
  sync.writeSyncStep1(enc, doc);
  return syncFrame(toUint8Array(enc));
}

// --- TC-05: create ------------------------------------------------------------

describe('TC-05: POST /api/boards creates a board', () => {
  it('→ 201 with id matching BOARD_ID_PATTERN; GET → 200; created_at set', async () => {
    const res = await postBoard();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await getBoard(body.id);
    expect(get.status).toBe(200);
    expect((await get.json()) as { id: string }).toEqual({ id: body.id });

    const info = await storageInfo(body.id);
    expect(info.createdAt).not.toBeNull();
  });
});

// --- TC-06: unknown board ------------------------------------------------------

describe('TC-06: GET unknown id → 404, nothing written', () => {
  it('a fresh never-created id gets 404 and leaves no tables behind', async () => {
    const id = newBoardId();
    const res = await getBoard(id);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    const info = await storageInfo(id);
    expect(info.tables).toEqual([]);
  });
});

// --- TC-07: malformed ids ------------------------------------------------------

describe('TC-07: malformed ids → 404, no RPC call', () => {
  it('abc, 21 chars, 23 chars and a slash all get 404 without touching the namespace', async () => {
    const before = await namespaceGets();
    const bad = ['abc', 'a'.repeat(21), 'a'.repeat(23), 'ab/c'];
    for (const id of bad) {
      const res = await getBoard(id);
      expect(res.status).toBe(404);
    }
    const after = await namespaceGets();
    expect(after).toBe(before);
  });
});

// --- TC-08: legacy boards ------------------------------------------------------

describe('TC-08: legacy board (updates rows, no created_at) exists', () => {
  it('seeded updates row without created_at → GET 200', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const { update } = makeSingleNoteUpdate();
    await runInDurableObject<BoardRoom, void>(stub, (room) => {
      void room.__testSeed([update]);
    });

    const res = await getBoard(id);
    expect(res.status).toBe(200);

    const info = await storageInfo(id);
    expect(info.createdAt).toBeNull();
    expect(info.updatesCount).toBe(1);
  });
});

// --- TC-09: WebSocket to unknown board -----------------------------------------

describe('TC-09: WebSocket upgrade to unknown id → 404, no storage', () => {
  it('no socket is accepted and no tables are created', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${id}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    );
    expect(res.status).toBe(404);
    expect((res as unknown as { webSocket?: unknown | null }).webSocket ?? undefined).toBeUndefined();

    const info = await storageInfo(id);
    expect(info.tables).toEqual([]);
  });
});

// --- TC-10: WebSocket to created board ------------------------------------------

describe('TC-10: WebSocket upgrade after POST → 101 and sync works', () => {
  it('connects and answers an empty SyncStep1 with a sync frame', async () => {
    const res = await postBoard();
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const wsRes = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${id}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    );
    expect(wsRes.status).toBe(101);
    const ws: any = (wsRes as unknown as { webSocket: any }).webSocket;
    ws.accept();
    ws.binaryType = 'arraybuffer';
    const frames: Uint8Array[] = [];
    ws.onmessage = (e: any) => frames.push(new Uint8Array(e.data));

    ws.send(emptySyncStep1());
    await sleep(250);

    // Story 3 sync: the room replies with a sync frame (SyncStep2 / update).
    expect(frames.some((f) => f[0] === MESSAGE_SYNC)).toBe(true);
    ws.close();
  });
});

// --- TC-12: RPC failure ----------------------------------------------------------

describe('TC-12: initialization failure → 500 create_failed', () => {
  it('initialize() throws when forced (verified in the test context, which the pool handles cleanly)', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    await runInDurableObject<BoardRoom, void>(stub, (room) => {
      room.__testSetFailInitialize(true);
    });
    let threw = false;
    try {
      await runInDurableObject<BoardRoom, 'created' | 'exists'>(stub, (room) =>
        room.initialize(),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // The throw happens before any write: nothing is created.
    const info = await storageInfo(id);
    expect(info.tables).toEqual([]);
  });

  it('POST /api/boards → 500 {"error":"create_failed"} on init failure; next create succeeds', async () => {
    const hook = await SELF.fetch(
      new Request('http://localhost/__test/fail-next-create', { method: 'POST' }),
    );
    expect(hook.status).toBe(200);

    const res = await postBoard();
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });

    // The failure is one-shot: creation works again.
    const res2 = await postBoard();
    expect(res2.status).toBe(201);
  });
});

// --- TC-14: wrong method -----------------------------------------------------------

describe('TC-14: wrong method on /api/boards → 405', () => {
  it('PUT /api/boards → 405', async () => {
    const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'PUT' }));
    expect(res.status).toBe(405);
  });
});

// --- TC-15: initialize is idempotent -------------------------------------------------

describe('TC-15: initialize() twice → created then exists', () => {
  it('second call reports exists and created_at is unchanged', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    const first = await runInDurableObject<BoardRoom, 'created' | 'exists'>(stub, (room) =>
      room.initialize(),
    );
    expect(first).toBe('created');
    const firstCreatedAt = (await storageInfo(id)).createdAt;
    expect(firstCreatedAt).not.toBeNull();

    const second = await runInDurableObject<BoardRoom, 'created' | 'exists'>(stub, (room) =>
      room.initialize(),
    );
    expect(second).toBe('exists');
    expect((await storageInfo(id)).createdAt).toBe(firstCreatedAt);
  });
});

// --- TC-32: privacy -------------------------------------------------------------------

describe('TC-32: served index.html has no-referrer meta', () => {
  it('the board page never sends the board link as a Referer to external origins', async () => {
    const res = await SELF.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
