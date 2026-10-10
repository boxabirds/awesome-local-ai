/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc } from '../../src/shared/board-model';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createBoard as createBoardForEnv } from '../../src/worker/create-board';
import type { BoardRoom } from '../../src/worker/board-room';
import type { Env } from '../../src/worker/index';
import { connectBoard, waitFor } from './ws-client';

// Story 5: board creation and existence (share.board_api). Every assertion
// about "nothing written" inspects the object's real SQLite after a read.
const testEnv = env as unknown as Env;
const fetcher = SELF.fetch.bind(SELF);

function url(path: string): string {
  return `https://example.com${path}`;
}

// Our three schema tables; used to prove a read leaves them absent.
const SCHEMA_TABLES = ['storage_meta', 'updates', 'snapshot_chunks'];

function ourTables(boardId: string): Promise<string[]> {
  return runInDurableObject(
    testEnv.BOARD_ROOM.get(testEnv.BOARD_ROOM.idFromName(boardId)),
    (room: BoardRoom) => {
      const names = new Set<string>();
      for (const row of room.debugStore().sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      )) {
        if (SCHEMA_TABLES.includes(row.name)) names.add(row.name);
      }
      return [...names];
    }
  );
}

function createdAt(boardId: string): Promise<string | undefined> {
  return runInDurableObject(
    testEnv.BOARD_ROOM.get(testEnv.BOARD_ROOM.idFromName(boardId)),
    (room: BoardRoom) => room.debugStore().debugCreatedAt()
  );
}

describe('Board API: create and check (TC-05..TC-08, TC-14)', () => {
  it('TC-05 POST creates a board that checks as existing with created_at set', async () => {
    const response = await fetcher(url('/api/boards'), { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const check = await fetcher(url(`/api/boards/${body.id}`));
    expect(check.status).toBe(200);
    expect((await check.json()) as { id: string }).toEqual({ id: body.id });

    // Existence is backed by created_at written during initialize().
    expect(await createdAt(body.id)).toMatch(/^\d+$/);
  });

  it('TC-06 GET of an unknown valid id is 404 and writes nothing', async () => {
    const id = newBoardId();
    const response = await fetcher(url(`/api/boards/${id}`));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
    // Probing a link must not create storage.
    expect(await ourTables(id)).toEqual([]);
  });

  it('TC-07 malformed ids are 404 and never reach the namespace', async () => {
    const namespace = testEnv.BOARD_ROOM;
    const original = namespace.idFromName.bind(namespace);
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (namespace as any).idFromName = (name: string) => {
      calls += 1;
      return original(name);
    };
    try {
      for (const bad of ['abc', 'x'.repeat(23), 'a'.repeat(21)]) {
        const response = await fetcher(url(`/api/boards/${bad}`));
        expect(response.status).toBe(404);
      }
      expect(calls).toBe(0);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (namespace as any).idFromName = original;
    }
  });

  it('TC-08 a legacy board with updates rows but no created_at checks as existing', async () => {
    const id = newBoardId();
    // Seed real updates with no created_at, as a pre-story-5 board would have.
    const seedDoc = new Y.Doc();
    initDoc(seedDoc);
    seedDoc.getMap('objects').set('seed', 'legacy content');
    const update = Y.encodeStateAsUpdate(seedDoc);
    await runInDurableObject(
      testEnv.BOARD_ROOM.get(testEnv.BOARD_ROOM.idFromName(id)),
      (room: BoardRoom) => room.debugStore().debugSeedUpdates([update])
    );
    expect(await createdAt(id)).toBeUndefined();

    const response = await fetcher(url(`/api/boards/${id}`));
    expect(response.status).toBe(200);
  });

  it('TC-14 the wrong method on /api/boards is 405', async () => {
    const response = await fetcher(url('/api/boards'), { method: 'PUT' });
    expect(response.status).toBe(405);
  });
});

describe('Board API: websocket existence gate (TC-09, TC-10)', () => {
  it('TC-09 connecting an unknown valid id is refused with 404 and writes nothing', async () => {
    const id = newBoardId();
    const response = await fetcher(url(`/api/rooms/${id}`), {
      headers: { Upgrade: 'websocket' }
    });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
    expect(await ourTables(id)).toEqual([]);
  });

  it('TC-10 connecting after POST is accepted and relays like story 3', async () => {
    const response = await fetcher(url('/api/boards'), { method: 'POST' });
    const { id } = (await response.json()) as { id: string };
    const a = await connectBoard(fetcher, id);
    const b = await connectBoard(fetcher, id);
    const doc = a.doc.getMap('objects');
    doc.set('probe', 'hello');
    await waitFor(() => b.doc.getMap('objects').has('probe'));
    a.closeNow();
    b.closeNow();
  });
});

describe('Board API: creation failure and idempotent init (TC-12, TC-15)', () => {
  it('TC-12 an initialize that throws yields create_failed (and a 500 route)', async () => {
    const direct = await createBoardForEnv(testEnv, {
      newId: () => newBoardId(),
      initialize: async () => {
        throw new Error('injected RPC failure');
      }
    });
    expect(direct).toEqual({ ok: false, reason: 'create_failed' });

    // Route level: patch the namespace so every stub's initialize throws.
    const namespace = testEnv.BOARD_ROOM;
    const originalGet = namespace.get.bind(namespace);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (namespace as any).get = () => ({
      initialize: async () => {
        throw new Error('injected RPC failure');
      }
    });
    try {
      const response = await fetcher(url('/api/boards'), { method: 'POST' });
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toBe('create_failed');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (namespace as any).get = originalGet;
    }
  });

  it('TC-15 initialize() twice on one object reports created then exists, created_at stable', async () => {
    const id = newBoardId();
    const stub = testEnv.BOARD_ROOM.get(testEnv.BOARD_ROOM.idFromName(id));
    const first = await stub.initialize();
    const created = await createdAt(id);
    expect(first).toBe('created');
    const second = await stub.initialize();
    expect(second).toBe('exists');
    expect(await createdAt(id)).toBe(created);
  });
});

describe('Board API: privacy (TC-32)', () => {
  it('TC-32 served index.html carries a no-referrer meta tag', async () => {
    const response = await fetcher(url('/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/);
  });
});
